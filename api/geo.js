// Tells the website which country a visit comes from, so the reports can count visits per
// country. The host works the country out from the network; nothing about the visitor is
// looked up, kept or passed on — only the two-letter country code is returned.
module.exports = (req, res) => {
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify({ country: /^[A-Z]{2}$/.test(country) ? country : '' }));
};
