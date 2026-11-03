/**
 * The validation container image, pinned by digest (NFR-09, C-07).
 *
 * The digest is the multi-architecture **index** digest of `node:22-bookworm-slim`, so the same
 * pin works on amd64 (CI) and arm64 (Apple silicon). Docker uses the digest and ignores the tag.
 *
 * How to update it:
 * 1. `docker buildx imagetools inspect node:22-bookworm-slim`, and copy the top-level `Digest:`
 *    (media type `application/vnd.oci.image.index.v1+json`), not a per-platform manifest.
 * 2. Replace {@link VALIDATOR_IMAGE_DIGEST} below and the matching line in the README.
 * 3. Run the validator integration tests (`npm test -w @sma/server`): consumer v1 must still
 *    give 12/12, and every isolation check must pass.
 * 4. Log the update in the current increment's `docs/decisions/incNN.md`.
 */

/** Image name and tag; informational only, because the digest is what Docker resolves. */
export const VALIDATOR_IMAGE_TAG = 'node:22-bookworm-slim';

/** Multi-arch index digest, looked up 2026-11-03 (image built 2026-10-28, Node v22.23.4). */
export const VALIDATOR_IMAGE_DIGEST =
  'sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da';

/** Full image reference passed to `docker run`. */
export const VALIDATOR_IMAGE = `${VALIDATOR_IMAGE_TAG}@${VALIDATOR_IMAGE_DIGEST}`;
