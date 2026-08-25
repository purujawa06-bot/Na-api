const cleanUrl = (input) => {
  if (!input) return input;
  const match = input.match(/\((https?:\/\/[^\s)]+)\)/) || input.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  if (match) return match[1];
  return input.trim();
};
module.exports = { cleanUrl };
