import { currentUser } from "@clerk/nextjs/server";
import { db } from "./prisma";

export const checkUser = async () => {
  // currentUser() throws - it does not return null - when Clerk cannot see its
  // middleware, which happens on internally rendered routes such as the
  // not-found page. The header renders on every route including those, so a
  // throw here would replace a clean 404 with an error page. Same rule as
  // getUnreadCount below: the header must not break because something it
  // merely consults is unavailable.
  let user;
  try {
    user = await currentUser();
  } catch {
    return null;
  }

  if (!user) {
    return null;
  }

  try {
    const loggedInUser = await db.user.findUnique({
      where: {
        clerkUserId: user.id,
      },
    });

    if (loggedInUser) {
      return loggedInUser;
    }

    const name = `${user.firstName} ${user.lastName}`;

    const newUser = await db.user.create({
      data: {
        clerkUserId: user.id,
        name,
        imageUrl: user.imageUrl,
        email: user.emailAddresses[0].emailAddress,
      },
    });

    return newUser;
  } catch (error) {
    console.log(error.message);
  }
};