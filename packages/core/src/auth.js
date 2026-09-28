// Deep module: auth.
// Hides the two-step dance (pretoken-check -> generatewebtoken).
// UI learns one method: login(). Tests cross the same seam.

const PRETOKEN = "/token/pretoken-check";
const GENTOKEN = "/token/generatewebtoken";
const CAPTCHA = "/token/getcaptcha";

/** GET captcha (public: no auth headers, no preflight). Returns {hidden, image, imageDataUrl}. */
export async function fetchCaptcha(client) {
  const body = await client.getPublic(CAPTCHA);
  const c = body.response.captcha;
  return { hidden: c.hidden, image: c.image, imageDataUrl: `data:image/jpeg;base64,${c.image}` };
}

/**
 * Full login. First manual login solves the image captcha;
 * afterwards the returned session is persisted by session store.
 */
export async function login(
  client,
  { username, password, captchaText, captcha, usertype = "S" }
) {
  const userField = usertype === "P" && !username.startsWith("P") ? `P${username}` : username;

  const pre = await client.post(PRETOKEN, {
    username: userField,
    usertype,
    captcha: { captcha: captchaText, hidden: captcha.hidden, image: captcha.image },
  });
  const random = pre.response.random;
  const otppwd = pre.response.otppwd;

  const gen = await client.post(GENTOKEN, {
    otppwd,
    username: userField,
    passwordotpvalue: password,
    Modulename: "STUDENTMODULE",
    random,
  });
  const r = gen.response.regdata;
  const institute = r.institutelist?.[0];
  return {
    token: r.token,
    clientid: r.clientid,
    companyid: r.companyid ?? null,
    userid: r.userid,
    name: r.name,
    membertype: r.membertype,
    enrollmentno: r.enrollmentno,
    instituteid: institute?.value ?? null,
    institutename: institute?.label ?? null,
    institutelist: r.institutelist ?? [],
    username: userField,
    bypassValue: r.bypass ?? null,
  };
}
