import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSameOrigin, hashPassword, verifyPassword, hashToken, randomToken, rateLimit } from '../src/lib/auth';
test('password hashes are salted and checked without storing plaintext',async()=>{
 const secret='test-only-long-password';const a=await hashPassword(secret);const b=await hashPassword(secret);
 assert.notEqual(a,b);assert.ok(!a.includes(secret));assert.equal(await verifyPassword(secret,a),true);assert.equal(await verifyPassword('wrong',a),false);assert.equal(await verifyPassword(secret,'malformed'),false);
});
test('opaque credentials are long, unique and hashed',()=>{const a=randomToken(),b=randomToken();assert.ok(a.length>=40);assert.notEqual(a,b);assert.notEqual(hashToken(a),a);assert.equal(hashToken(a).length,64);});
test('mutations reject foreign origins',()=>{
 assert.doesNotThrow(()=>assertSameOrigin(new Request('http://localhost:3100/api/review',{headers:{host:'localhost:3100',origin:'http://localhost:3100'}})));
 assert.throws(()=>assertSameOrigin(new Request('http://localhost:3100/api/review',{headers:{host:'localhost:3100',origin:'https://attacker.invalid'}})));
 assert.throws(()=>assertSameOrigin(new Request('http://localhost:3100/api/review',{headers:{'sec-fetch-site':'cross-site'}})));
});
test('authentication attempts have bounded rate',()=>{const key=randomToken();rateLimit(key,2);rateLimit(key,2);assert.throws(()=>rateLimit(key,2));});
