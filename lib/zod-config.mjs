// Zod without generated code. The dashboard's content security policy allows no eval, and zod's probe for it is
// reported as a policy violation even though zod then falls back. Imported first wherever zod is used, so the
// setting is in place before any schema parses.
import { z } from 'zod';

z.config({ jitless: true });
