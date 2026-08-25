const cleanUrl = (url) => {
  return url.replace(/\-\[.*?\]\(.*?\)/g, "").trim();
};
module.exports = { cleanUrl };
