/**
 * Dev-only relay for the EBI Proteins variation API. Chromium drops this endpoint's compressed
 * HTTP/2 response (net::ERR_HTTP2_PROTOCOL_ERROR), so /dev/sequence falls back to reading it here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accession: string }> },
) {
  const { accession } = await params;
  if (!/^[A-Z0-9]{6,10}(-\d+)?$/.test(accession)) {
    return Response.json({ error: "Not a UniProt accession" }, { status: 400 });
  }
  try {
    const upstream = await fetch(
      `https://www.ebi.ac.uk/proteins/api/variation/${accession}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "no answer" },
      { status: 502 },
    );
  }
}
