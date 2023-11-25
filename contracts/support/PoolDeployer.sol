// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/utr/contracts/NotToken.sol";
import "../libs/MetaProxyFactory.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IPool.sol";
import "../interfaces/IWeth.sol";

/// @title Factory contract to deploy Derivable pool using ERC-3448.
/// @author Derivable Labs
contract PoolDeployer is NotToken, IPoolFactory {
    /// @notice PoolLogic contract
    address public immutable LOGIC;
    address internal immutable WETH;

    /// @param logic PoolLogic contract address
    constructor(address weth, address logic) {
        require(logic != address(0) && weth != address(0), "PoolFactory: ZERO_ADDRESS");
        WETH = weth;
        LOGIC = logic;
    }

    function deploy(
        Config memory config,
        State memory state,
        Payment memory payment,
        address baseToken,
        bytes32 baseSymbol,
        bytes32 topic2,
        bytes32 topic3
    ) external payable returns (address pool) {
        pool = create(config);
        require(pool != address(0), "PoolDeployer: CREATE2_FAILED");
        if (config.TOKEN_R == WETH) {
            IWeth(WETH).deposit{value : msg.value}();
            uint256 amount = IERC20(WETH).balanceOf(address(this));
            IERC20(WETH).approve(pool, amount);
        } else {
            require(msg.value == 0, "PoolDeployer: UNUSED_VALUE");
        }
        IPool(pool).init(state, payment);
        require(IERC20(config.TOKEN_R).balanceOf(pool) >= state.R, "PoolDeployer: POOL_INIT_FAILED");
        _emit(
            baseToken,
            baseSymbol,
            topic2,
            topic3,
            _encode(config, pool)
        );
    }

    function _encode(
        Config memory config,
        address pool
    ) internal pure returns (bytes memory) {
        return abi.encode(
            config.FETCHER,
            config.ORACLE,
            config.K,
            config.MARK,
            config.INTEREST_HL,
            config.PREMIUM_HL,
            config.MATURITY,
            config.MATURITY_VEST,
            config.MATURITY_RATE,
            config.OPEN_RATE,
            pool
        );
    }

    /// deploy a new Pool using MetaProxy
    /// @param config immutable configs for the pool
    function create(
        Config memory config
    ) public returns (address pool) {
        bytes memory input = abi.encode(config);
        pool = MetaProxyFactory.metaProxyFromBytes(LOGIC, input);
    }

    function _emit(
        address baseToken,
        bytes32 baseSymbol,
        bytes32 topic2,
        bytes32 topic3,
        bytes memory data
    ) internal {
        assembly {
            log4(
                add(data, 0x20),
                mload(data),
                baseToken,
                baseSymbol,
                topic2,
                topic3
            )
        }
    }
}
