// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

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
                xt = xt > block.timestamp ? (xt - block.timestamp) : 0;
                yt = yt > block.timestamp ? (yt - block.timestamp) : 0;
                uint num = xt * xb + yt * yb;   // TODO: overflow?
                z = num / zb;
                if (z * zb < num) {
                    ++z; // rounding up
                }
                if (z > 0) {
                    z += block.timestamp;
                    require(z <= type(uint32).max, "Timelock: uint32 overflow");
                }
                z <<= 224;
            } else {
                z = xt <= block.timestamp ? 0 : (xt << 224);
            }
            z |= zb;
        }
    }

    function sub(uint x, uint y) internal view returns (uint) {
        unchecked {
            require(x >> 224 <= block.timestamp, "Timelock: unexpired");
            uint xb = x & type(uint224).max;
            if (xb == y) {
                return 0;
            }
            require(xb > y, "Timelock: insufficient balance for transfer");
            return xb - y;
        }
    }
}
