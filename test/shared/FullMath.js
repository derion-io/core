
function mulDivRoundingUp(a, b, x) {
  let result = a.mul(b).div(x)
  if (result.mul(x).div(b).lt(a))
      result = result.add(1)
  return result
}

module.exports = {
  mulDivRoundingUp
}