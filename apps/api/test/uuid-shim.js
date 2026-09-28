// Jest runs CommonJS; uuid@14 (pulled in by TypeORM) ships ESM only. TypeORM needs v4.
const { randomUUID } = require('node:crypto');
module.exports = { v4: randomUUID, v1: randomUUID, validate: () => true, NIL: '00000000-0000-0000-0000-000000000000' };
