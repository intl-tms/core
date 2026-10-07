/**
 * The name of the cookie that signals an editing session. The website and
 * every editing tool read this same constant.
 *
 * The Toggle is a user-interface switch and protects nothing: anyone can set a
 * cookie. Authorization on the request handler is where protection lives.
 */
export const TOGGLE_COOKIE_NAME = "tms-edit";

/** The cookie value that means editing is on. Absent or anything else means off. */
export const TOGGLE_ON_VALUE = "1";
