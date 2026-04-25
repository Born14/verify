// Synthetic HTTP-03 trigger: external fetch with no AbortController and no
// request-level timeout. Should fire HTTP-03 (warning) per the calibrated
// rubric.

export async function fetchUserProfile(id: string): Promise<unknown> {
  const response = await fetch(`https://api.example.com/users/${id}`);
  return response.json();
}
