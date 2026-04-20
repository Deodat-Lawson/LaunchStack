// 1) A helper function that retries fetch up to `maxRetries` times
export async function fetchWithRetries(
    url: string,
    options: RequestInit = {},
    maxRetries = 5
) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                // For a non-200 response, you can parse the error body or just throw.
                const rawErrorData : unknown = await res.json().catch(() => ({}));

                if(typeof rawErrorData !== "object") {
                    throw new Error(`Request failed with status ${res.status}`);
                }

                const errorData = rawErrorData as { error?: string };

                throw new Error(errorData.error ?? `Request failed with status ${res.status}`);
            }

            // If fetch + response parsing is successful, return the JSON
            const data: unknown = await res.json(); // Store in a variable
            return data; // Then return the resolved value
        } catch (err: unknown) {
            lastError = err;

            // Check if it's specifically a "timeout" or "network" error
            if (err instanceof Error) {
                const isTimeoutError =
                    /timed out/i.test(err.message) || err.name === "AbortError";

                if (isTimeoutError && attempt < maxRetries) {
                    console.warn(`Attempt ${attempt} failed due to timeout, retrying...`);
                    continue; // Go to the next attempt
                }

                // If it's a non-timeout error or we've used all retries, re-throw
                throw err; // This is safe now because `err` is an Error
            } else {
                // Wrap non-Error in a real Error
                throw new Error(`Non-Error thrown: ${String(err)}`);
            }
        }
    }

    // If we somehow exit the loop, throw the last error
    // If `lastError` is not an Error, wrap it
    if (!(lastError instanceof Error)) {
        throw new Error(`Non-Error thrown: ${String(lastError)}`);
    }
    throw lastError;
}