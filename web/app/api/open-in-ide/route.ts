import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execP = promisify(exec);

const MODULES_ROOT = process.env.MODULES_ROOT
  ? resolve(process.env.MODULES_ROOT)
  : resolve(process.cwd(), '..', 'modules');

/**
 * Opens a file in IntelliJ IDEA via macOS `open -a` so it works in any
 * browser (including Safari, which is strict with custom URL schemes).
 *
 * Single-user localhost — no auth — but we still constrain the path to
 * sit inside MODULES_ROOT so a stray request can't open arbitrary files.
 */
export async function POST(req: NextRequest) {
  let filePath: string;
  try {
    const body = await req.json();
    filePath = String(body?.filePath ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!filePath) {
    return NextResponse.json({ error: 'filePath required' }, { status: 400 });
  }
  const abs = resolve(filePath);
  if (!abs.startsWith(MODULES_ROOT)) {
    return NextResponse.json(
      { error: `path outside MODULES_ROOT: ${abs}` },
      { status: 400 },
    );
  }

  // Pass the path as a positional argv to avoid shell-quoting bugs on
  // unusual filenames. exec splits on whitespace by default, so we
  // assemble the command with explicit argv quoting.
  const safe = abs.replace(/"/g, '\\"');
  try {
    await execP(`open -a "IntelliJ IDEA" "${safe}"`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Fallback: try the JetBrains Toolbox-installed `idea` CLI launcher.
    try {
      await execP(`idea "${safe}"`);
      return NextResponse.json({ ok: true, fallback: 'idea-cli' });
    } catch (err2) {
      const msg = (err as Error).message;
      const msg2 = (err2 as Error).message;
      return NextResponse.json(
        { error: `open -a failed: ${msg}; idea CLI failed: ${msg2}` },
        { status: 500 },
      );
    }
  }
}
