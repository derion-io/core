const { solidity } = require("ethereum-waffle")
const chai = require("chai")
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { numberToWei, weiToNumber} = require("./shared/utilities")

chai.use(solidity)

const BSC_ADDRESS = {
  BNB: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  USDT: "0x55d398326f99059ff775485246999027b3197955",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  ETH: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
  UNI: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
}

const parseSqrtX96 = (price, baseToken, quoteToken) => {
  return weiToNumber(
    price
      .mul(price)
      .mul(numberToWei(1, baseToken.decimal + 18))
      .shr(192),
    quoteToken.decimal + 18,
  )
}

async function deployContract(name, args) {
  const contractFactory = await ethers.getContractFactory(name)
  return await contractFactory.deploy(...args)
}

describe("Test get token price by router", () => {

  async function getFixture() {
    let pairDetailV3

    pairDetailV3 = await deployContract("TokenPriceByRoute", []);

    return {
      pairDetailV3,
    }
  }

  it('Get price with route v2 ', async () => {
    const {pairDetailV3} = await loadFixture(getFixture)

    const res = await pairDetailV3.fetchPrice(
      BSC_ADDRESS.WBNB,
      BSC_ADDRESS.BUSD,
      [
        {
          version: 2,
          uniPool: '0x014608E87AF97a054C9a49f81E1473076D51d9a3',
        },
        {
          version: 2,
          uniPool: '0x0E91275Aec7473105c8509BC41AE54b8FE8a7Fc3',
        }
      ]
    )

    const price = parseSqrtX96(res, {decimal: 18}, {decimal: 18})
    console.log('price BNB / USD', price)
  })

  it('Get price with route v3 ', async () => {
    const {pairDetailV3} = await loadFixture(getFixture)

    const res = await pairDetailV3.fetchPrice(
      BSC_ADDRESS.WBNB,
      BSC_ADDRESS.ETH,
      [
        {
          version: 3,
          uniPool: '0x85FAac652b707FDf6907EF726751087F9E0b6687',
        },
        {
          version: 3,
          uniPool: '0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5',
        },
      ]
    )

    const price = parseSqrtX96(res, {decimal: 18}, {decimal: 18})
    console.log('price BNB / ETH (v3)', price)

  })

  it('Get price with mixed route ', async () => {
    const {pairDetailV3} = await loadFixture(getFixture)

    const res = await pairDetailV3.fetchPrice(
      BSC_ADDRESS.WBNB,
      BSC_ADDRESS.ETH,
      [
        {
          version: 2,
          uniPool: '0x014608E87AF97a054C9a49f81E1473076D51d9a3',
        },
        {
          version: 2,
          uniPool: '0x0E91275Aec7473105c8509BC41AE54b8FE8a7Fc3',
        },
        {
          version: 2,
          uniPool: '0x7EFaEf62fDdCCa950418312c6C91Aef321375A00',
        },

        {
          version: 3,
          uniPool: '0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5',
        },
      ]
    )

    const price = parseSqrtX96(res, {decimal: 18}, {decimal: 18})
    console.log('price BNB / ETH (mix v2 & v3)', price)
  })

  it('Get prices with mixed route ', async () => {
    const {pairDetailV3} = await loadFixture(getFixture)

    const res = await pairDetailV3.fetchPrices([
        {
          tokenBase: BSC_ADDRESS.WBNB,
          tokenQuote: BSC_ADDRESS.ETH,
            routes: [
            {
              version: 2,
              uniPool: '0x014608E87AF97a054C9a49f81E1473076D51d9a3',
            },
            {
              version: 2,
              uniPool: '0x0E91275Aec7473105c8509BC41AE54b8FE8a7Fc3',
            },
            {
              version: 2,
              uniPool: '0x7EFaEf62fDdCCa950418312c6C91Aef321375A00',
            },
            {
              version: 3,
              uniPool: '0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5',
            },
          ]
        }
      ]
    )

    const price = parseSqrtX96(res[0], {decimal: 18}, {decimal: 18})
    console.log('price BNB / ETH (mix v2 & v3)', price)
  })
})
