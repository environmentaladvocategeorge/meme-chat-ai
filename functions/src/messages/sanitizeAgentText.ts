// Strips artifacts the model sometimes emits when it attaches a meme via the
// get_meme tool: markdown image embeds, attachment:// links, and bare
// attachment placeholders. The meme is rendered to the user out-of-band as its
// own image (see streamAgentAnswer "meme" event + finalizeAgentMessage), so
// none of this belongs in the text reply.
//
// This is defense-in-depth: the tool prompt (MEME_TOOL_GUIDANCE / the tool
// description) already tells the model never to write image syntax or the
// meme's title, but a model can still drift, so we scrub the persisted text.
export function stripMemeArtifacts(text: string): string {
  return (
    text
      // Markdown image embeds: ![alt](anything)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Markdown link form pointing at an attachment: [label](attachment://...)
      .replace(/\[[^\]]*\]\(\s*attachment:\/\/[^)]*\)/gi, "")
      // Bare attachment:// placeholder tokens
      .replace(/attachment:\/\/\S+/gi, "")
      // Collapse blank-line runs the removals leave behind
      .replace(/\n{3,}/g, "\n\n")
      // Drop trailing whitespace per line, then trim the whole thing
      .replace(/[ \t]+$/gm, "")
      .trim()
  );
}
