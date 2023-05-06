// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "./SimpleMath.sol";

library TimelockBalance {
    function pack(uint a, uint t) internal pure returns (uint) {
        require(t <= type(uint32).max, "Timelock: uint32 overflow");
        require(a <= type(uint224).max, "Timelock: uint224 overflow");
        return a | (t << 224);
    }

    function amount(uint x) internal pure returns (uint) {
        unchecked {
            return x & type(uint224).max;
        }
    }

    function locktime(uint x) internal pure returns (uint) {
        unchecked {
            return x >> 224;
        }
    }

    function add(uint x, uint y) internal view returns (uint z) {
        unchecked {
            if (x == 0) {
                return y;
            }
            uint xb = x & type(uint224).max;
            uint yb = y & type(uint224).max;
            uint zb = xb + yb;
            require(zb <= type(uint224).max, "Timelock: uint224 overflow");
            uint xt = x >> 224;
            uint yt = y >> 224;
            if (xt != yt) {
                x = xt > block.timestamp ? xb * (xt - block.timestamp) : 0;
                y = yt > block.timestamp ? yb * (yt - block.timestamp) : 0;
                z = SimpleMath.avgRoundingUp(x, y, zb);
                if (z > 0) {
                    z += block.timestamp;
                    require(z <= type(uint32).max, "Timelock: uint32 overflow");
                }
                z <<= 224;
            } else {
                z = xt > block.timestamp ? (xt << 224) : 0;
            }
            z |= zb;
        }
    }

    function sub(uint x, uint y) internal view returns (uint) {
        unchecked {
            require(x >> 224 <= block.timestamp, "Timelock: unexpired");
            x &= type(uint224).max;
            if (x == y) {
                return 0;
            }
            require(x > y, "Timelock: insufficient balance for transfer");
            return x - y;
        }
    }
}
