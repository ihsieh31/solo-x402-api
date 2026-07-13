module.exports = (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    node: process.version,
    message: 'Hello from Vercel!'
  });
};
