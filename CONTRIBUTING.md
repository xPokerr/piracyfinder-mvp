# Contributing

Small, idiomatic changes only. Match existing style; no new dependencies without discussion.

1. `npm install`
2. `npm test && npm run typecheck`
3. Keep worker and web within the `shared/types.ts` contract.
4. New sources: add one adapter in `worker/src/sources/`, register it, keep it to public unauthenticated APIs, and add a mocked-fetch test.
