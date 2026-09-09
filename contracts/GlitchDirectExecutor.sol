// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interfaces only. The executor is intentionally dependency-free.
interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IUniswapV3FactoryMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3PoolMinimal {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @title GlitchDirectExecutor
/// @notice Holder-gated, stateless exact-input executor that talks directly to canonical Uniswap V3 pools.
/// @dev No owner, no admin, no protocol fee, no custody storage.
///      It is designed to be one candidate inside GLITCH ROUTER, not the only route.
contract GlitchDirectExecutor {
    address public immutable FACTORY;
    address public immutable WETH;
    address public immutable DEAD_PIXELS;

    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE =
        1461446703485210103287273052203988822378723970341;

    uint32 private constant SINGLE_NATIVE_IN  = 1 << 24;
    uint32 private constant SINGLE_NATIVE_OUT = 1 << 25;

    uint64 private constant TWO_NATIVE_IN  = uint64(1) << 48;
    uint64 private constant TWO_NATIVE_OUT = uint64(1) << 49;

    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 private constant TRANSFER_FROM_SELECTOR = 0x23b872dd;

    error NotHolder();
    error InvalidAmount();
    error InvalidPair();
    error InvalidPool();
    error InvalidCallback();
    error InvalidNativeValue();
    error InsufficientOutput();
    error TokenTransferFailed();
    error EthTransferFailed();
    error UnexpectedETH();

    struct CallbackData {
        address tokenIn;
        address tokenOut;
        address payer;
        uint24 fee;
    }

    /// @dev Packing swap arguments into memory prevents Solidity's legacy
    /// code generator from running out of EVM stack slots.
    struct SwapRequest {
        address pool;
        address tokenIn;
        address tokenOut;
        address payer;
        address recipient;
        uint256 amountIn;
        uint24 fee;
    }

    constructor(address factory_, address weth_, address deadPixels_) {
        if (factory_ == address(0) || weth_ == address(0) || deadPixels_ == address(0)) {
            revert InvalidPair();
        }
        FACTORY = factory_;
        WETH = weth_;
        DEAD_PIXELS = deadPixels_;
    }

    /// @dev Only WETH9.withdraw() is allowed to push raw ETH into this contract.
    receive() external payable {
        if (msg.sender != WETH) revert UnexpectedETH();
    }

    /// @notice Direct single-pool exact-input swap for any amount.
    /// @param pool Canonical Uniswap V3 pool address, provided offchain to avoid an extra factory lookup before swap.
    /// @param tokenIn ERC20 input token. Use WETH when native ETH is the user input.
    /// @param tokenOut ERC20 output token. Use WETH when native ETH is desired as output.
    /// @param feeAndFlags Lower 24 bits = pool fee. Bit 24 = native ETH input. Bit 25 = unwrap WETH output to ETH.
    /// @param amountIn Exact input amount.
    /// @param minAmountOut Slippage-protected minimum output.
    function swapSingle(
        address pool,
        address tokenIn,
        address tokenOut,
        uint32 feeAndFlags,
        uint256 amountIn,
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut) {
        _requireHolder();
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert InvalidAmount();
        if (tokenIn == tokenOut || pool == address(0)) revert InvalidPair();

        uint24 fee = uint24(feeAndFlags);
        bool nativeIn = (feeAndFlags & SINGLE_NATIVE_IN) != 0;
        bool nativeOut = (feeAndFlags & SINGLE_NATIVE_OUT) != 0;

        address payer;
        if (nativeIn) {
            if (tokenIn != WETH || msg.value != amountIn) revert InvalidNativeValue();
            IWETH9(WETH).deposit{value: amountIn}();
            payer = address(this);
        } else {
            if (msg.value != 0) revert InvalidNativeValue();
            payer = msg.sender;
        }

        if (nativeOut && tokenOut != WETH) revert InvalidPair();

        address recipient = nativeOut ? address(this) : msg.sender;
        SwapRequest memory req;
        req.pool = pool;
        req.tokenIn = tokenIn;
        req.tokenOut = tokenOut;
        req.payer = payer;
        req.recipient = recipient;
        req.amountIn = amountIn;
        req.fee = fee;

        amountOut = _swap(req);

        if (amountOut < minAmountOut) revert InsufficientOutput();

        if (nativeOut) {
            IWETH9(WETH).withdraw(amountOut);
            _sendETH(msg.sender, amountOut);
        }
    }

    /// @notice Two-pool exact-input route for any amount.
    /// @param pool0 First canonical V3 pool.
    /// @param pool1 Second canonical V3 pool.
    /// @param tokenIn ERC20 input token. Use WETH for native ETH input.
    /// @param tokenMid Intermediate ERC20 token.
    /// @param tokenOut ERC20 output token. Use WETH for native ETH output.
    /// @param feesAndFlags Bits 0..23 fee0, 24..47 fee1, bit48 native input, bit49 native output.
    /// @param amountIn Exact input amount.
    /// @param minAmountOut Slippage-protected final minimum output.
    function swapTwoHop(
        address pool0,
        address pool1,
        address tokenIn,
        address tokenMid,
        address tokenOut,
        uint64 feesAndFlags,
        uint256 amountIn,
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut) {
        _requireHolder();
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert InvalidAmount();
        if (
            pool0 == address(0) ||
            pool1 == address(0) ||
            tokenIn == tokenMid ||
            tokenMid == tokenOut ||
            tokenIn == tokenOut
        ) revert InvalidPair();

        uint24 fee0 = uint24(feesAndFlags);
        uint24 fee1 = uint24(feesAndFlags >> 24);
        bool nativeIn = (feesAndFlags & TWO_NATIVE_IN) != 0;
        bool nativeOut = (feesAndFlags & TWO_NATIVE_OUT) != 0;

        address payer;
        if (nativeIn) {
            if (tokenIn != WETH || msg.value != amountIn) revert InvalidNativeValue();
            IWETH9(WETH).deposit{value: amountIn}();
            payer = address(this);
        } else {
            if (msg.value != 0) revert InvalidNativeValue();
            payer = msg.sender;
        }

        if (nativeOut && tokenOut != WETH) revert InvalidPair();

        // Reuse one memory request for both hops. Besides saving bytecode,
        // this keeps the legacy compiler below the EVM stack-depth limit.
        SwapRequest memory req;
        req.pool = pool0;
        req.tokenIn = tokenIn;
        req.tokenOut = tokenMid;
        req.payer = payer;
        req.recipient = address(this);
        req.amountIn = amountIn;
        req.fee = fee0;

        uint256 amountMid = _swap(req);

        req.pool = pool1;
        req.tokenIn = tokenMid;
        req.tokenOut = tokenOut;
        req.payer = address(this);
        req.recipient = nativeOut ? address(this) : msg.sender;
        req.amountIn = amountMid;
        req.fee = fee1;

        amountOut = _swap(req);

        if (amountOut < minAmountOut) revert InsufficientOutput();

        if (nativeOut) {
            IWETH9(WETH).withdraw(amountOut);
            _sendETH(msg.sender, amountOut);
        }
    }

    /// @notice Uniswap V3 callback. Canonical pool verification prevents arbitrary callback callers.
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        CallbackData memory d = abi.decode(data, (CallbackData));

        address canonical = IUniswapV3FactoryMinimal(FACTORY).getPool(
            d.tokenIn,
            d.tokenOut,
            d.fee
        );
        if (canonical == address(0) || msg.sender != canonical) revert InvalidCallback();

        bool zeroForOne = d.tokenIn < d.tokenOut;
        uint256 amountToPay;

        if (zeroForOne) {
            if (amount0Delta <= 0 || amount1Delta > 0) revert InvalidCallback();
            amountToPay = uint256(amount0Delta);
        } else {
            if (amount1Delta <= 0 || amount0Delta > 0) revert InvalidCallback();
            amountToPay = uint256(amount1Delta);
        }

        if (d.payer == address(this)) {
            _safeTransfer(d.tokenIn, msg.sender, amountToPay);
        } else {
            _safeTransferFrom(d.tokenIn, d.payer, msg.sender, amountToPay);
        }
    }

    function _swap(
        SwapRequest memory req
    ) private returns (uint256 amountOut) {
        bool zeroForOne = req.tokenIn < req.tokenOut;
        uint160 limit = zeroForOne
            ? MIN_SQRT_RATIO_PLUS_ONE
            : MAX_SQRT_RATIO_MINUS_ONE;

        CallbackData memory callbackData = CallbackData({
            tokenIn: req.tokenIn,
            tokenOut: req.tokenOut,
            payer: req.payer,
            fee: req.fee
        });

        (int256 amount0, int256 amount1) = IUniswapV3PoolMinimal(req.pool).swap(
            req.recipient,
            zeroForOne,
            int256(req.amountIn),
            limit,
            abi.encode(callbackData)
        );

        if (zeroForOne) {
            if (amount1 >= 0) revert InvalidPool();
            amountOut = uint256(-amount1);
        } else {
            if (amount0 >= 0) revert InvalidPool();
            amountOut = uint256(-amount0);
        }
    }

    function _requireHolder() private view {
        if (IERC20Minimal(DEAD_PIXELS).balanceOf(msg.sender) == 0) revert NotHolder();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(TRANSFER_SELECTOR, to, amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(TRANSFER_FROM_SELECTOR, from, to, amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _sendETH(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
