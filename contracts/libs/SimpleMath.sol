// SPDX-License-Identifier: None
pragma solidity ^0.8.9;

// a library for performing various math operations
// Copy from "@uniswap/v2-core/contracts/libraries/Math.sol" and change solidity version

library SimpleMath {
    function sub(uint x, uint y) internal pure returns (int z) {
        z = x > y ? int(x-y) : -int(y-x);
    }

    function add(uint x, int y) internal pure returns (uint z) {
        z = y > 0 ? x - uint(y) : x + uint(-y);
    }

    function abs(int x) internal pure returns (uint z) {
        z = uint(x >= 0 ? x : -x);
    }

    function max(uint x, uint y) internal pure returns (uint z) {
        z = x > y ? x : y;
    }

    function min(uint x, uint y) internal pure returns (uint z) {
        z = x < y ? x : y;
    }

    function divRoundingUp(uint x, uint y) internal pure returns (uint z) {
        unchecked {
            z = x / y;
            if (z * y < x) {
                ++z;
            }
        }
    }

    function avgRoundingUp(uint x, uint y, uint z) internal pure returns (uint) {
        unchecked {
            uint s = x + y;
            if (s > x) {
                return divRoundingUp(s, z);
            }
            // addition overflow
            return divRoundingUp(x, z) + divRoundingUp(y, z);
        }
    }

    // babylonian method (https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method)
    function sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}