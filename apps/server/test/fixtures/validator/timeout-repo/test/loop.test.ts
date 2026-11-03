import { it } from 'vitest';

// Never finishes: the sandbox wall clock must kill the container.
it('timeout probe: infinite loop', () => {
  for (;;) {
    // busy loop on purpose
  }
});
