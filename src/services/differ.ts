import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();

export interface DiffResult {
  diffText: string;
  changeScore: number;
}

/**
 * Compute a diff between old and new text content.
 *
 * Returns:
 *   - diffText: human-readable patch string
 *   - changeScore: 0..1 ratio of changed characters to total characters
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const patches = dmp.patch_make(oldText, diffs);
  const diffText = dmp.patch_toText(patches);

  // changeScore = proportion of text that changed
  const totalLength = Math.max(oldText.length, newText.length, 1);
  let changedChars = 0;
  for (const [op, text] of diffs) {
    if (op !== 0) {
      changedChars += text.length;
    }
  }
  const changeScore = changedChars / totalLength;

  return { diffText, changeScore };
}
