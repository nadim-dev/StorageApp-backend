import axios from "axios";

export async function getVerifiedGithubEmail(accessToken, requestConfig = {}) {
  const emailRes = await axios.get(
    "https://api.github.com/user/emails",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "drive-app-auth",
        Authorization: `Bearer ${accessToken}`,
      },
      ...requestConfig,
    }
  );

  // pick primary + verified email
  const primaryEmail = emailRes.data.find(
    (e) => e.primary === true && e.verified === true
  );

  return primaryEmail?.email || null;
}
