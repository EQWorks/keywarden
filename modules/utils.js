/**
 * Capitalizes the first letter of a string and makes the rest lowercase
 * @param {string} str - The string to capitalize
 * @returns {string} The capitalized string
 */
function capitalizeFirstLetter(str) {
  if (!str) return ''
  return str[0].toUpperCase() + str.slice(1).toLowerCase()
}

module.exports = {
  capitalizeFirstLetter,
}
