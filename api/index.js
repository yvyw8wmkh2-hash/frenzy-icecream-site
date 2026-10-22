// Vercel serverless entry point. vercel.json rewrites every path that is not a static file in
// public/ to this function, and the shared router in server.js handles it (pages, admin, API,
// /uploads/<id>, /healthz). Module state (the pg Pool, the config cache) is reused while the
// instance stays warm; schema creation + seeding run lazily on the first request.
'use strict';
const { handler } = require('../server');

module.exports = (req, res) => handler(req, res);
