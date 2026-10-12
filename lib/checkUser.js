import "server-only";

import { getAppUserOrNull } from "./appUser";

/**
 * Provision the signed-in user's row from <Header/>, which renders on every
 * route including internally rendered ones.
 *
 * The work itself now lives in ensureAppUser() so that every server action
 * shares one race-free implementation. This wrapper exists only to keep the
 * header's contract: it must never throw. currentUser() throws rather than
 * returning null when Clerk cannot see its middleware - which is what happens
 * on the not-found page - and a throw here would replace a clean 404 with an
 * error page.
 *
 * Failures are logged at console.error rather than swallowed. The previous
 * version logged at console.log and returned undefined, which is why a
 * completely unreachable database still served HTTP 200 on the landing page.
 */
export const checkUser = async () => getAppUserOrNull();
