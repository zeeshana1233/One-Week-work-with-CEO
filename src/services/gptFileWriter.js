import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
const execFile = promisify(_execFile);

/**
 * Write parsed GPT files to disk, creating directories as necessary.
 * files: Array<{ filepath, code }>
 * baseDir: absolute path where files should be created
 */
async function writeFilesToDisk(files, baseDir, logFn = console.log) {
  if (!Array.isArray(files)) throw new Error('files must be an array');
  if (!baseDir) throw new Error('baseDir is required');

  logFn(`🖨️ Writing ${files.length} files to disk at: ${baseDir}`);

  let successCount = 0;
  let failCount = 0;
  const issues = [];

  for (const file of files) {
    let cleanedPath = (file.filepath || '').replace(/^\/+/, '');
    const targetPath = path.resolve(baseDir, cleanedPath);
    const dir = path.dirname(targetPath);

    // If the file's basename (without extension) is 'readme', skip writing it.
    // This preserves any README handling elsewhere (we don't overwrite README files).
    try {
      const parsed = path.parse(cleanedPath || '');
      if (parsed.name && parsed.name.toLowerCase() === 'readme') {
        logFn(`  ℹ️ Skipping README file: ${cleanedPath || '<unknown>'}`);
        issues.push({ file: cleanedPath || '<unknown>', issue: 'skipped readme' });
        continue;
      }
    } catch (e) {
      // if path.parse fails for some reason, don't block writing other files
    }

    try {
      // Ensure directory exists
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Get content from either 'code' or 'content' property
        const content = file.code || file.content || '';

        // Coerce content into a string for checks but preserve original for writing
        let contentStr;
        let writeData;
        if (Buffer.isBuffer(content)) {
          // Binary buffer - keep buffer for write, but inspect text representation for warnings
          writeData = content;
          contentStr = content.toString('utf8');
        } else if (typeof content === 'string') {
          writeData = content;
          contentStr = content;
        } else if (content === null || content === undefined) {
          writeData = '';
          contentStr = '';
        } else {
          // Objects or other types - stringify to readable source
          try {
            contentStr = JSON.stringify(content, null, 2);
          } catch (err) {
            contentStr = String(content);
          }
          writeData = contentStr;
        }

        // Sanitize common GPT/markdown artifacts before writing
        if (typeof contentStr === 'string') {
          const sanitize = (s) => {
            let out = String(s || '');
            // Trim leading BOM and whitespace
            out = out.replace(/^\uFEFF/, '').replace(/^\s+/, '');

            // If wrapped in a single code block, remove the surrounding fences
            // Remove only the outermost opening fence and closing fence if present
            out = out.replace(/^```[\w-]*\r?\n/, '');
            out = out.replace(/\r?\n```\s*$/m, '');

            // Repeatedly strip a leading single-token language tag (like 'json' or 'js')
            // that may appear on its own line or immediately before a JSON bracket.
            // Do this in a loop to handle cases like "json\njson[..." or extra blank lines.
            let prev;
            do {
              prev = out;
              // Remove a line that is only a language token followed by newline
              out = out.replace(/^[\t ]*([A-Za-z0-9_-]{1,30})[\t ]*\r?\n(?=[\[{\"'])/, '');
              // Remove a token immediately before an opening bracket/brace (e.g. "json[")
              out = out.replace(/^[\t ]*([A-Za-z0-9_-]{1,30})(?=[\[{\"'])/, '');
              // Also remove a leading single token followed by a colon (e.g. "json:")
              out = out.replace(/^[\t ]*([A-Za-z0-9_-]{1,30}):[\t ]*\r?\n(?=[\[{\"'])/, '');
              // Trim leading whitespace introduced by removals
              out = out.replace(/^\s+/, '');
            } while (out !== prev);

            // Remove leading shebangs such as "#!/usr/bin/env node"
            // and combined tokens like "js#!/usr/bin/env node".
            // This strips the entire shebang line (with optional trailing newline).
            out = out.replace(/^[\t ]*(?:[A-Za-z0-9_-]{1,30})?#![^\r\n]*\r?\n?/, '');
            // Trim any whitespace introduced by removals
            out = out.replace(/^\s+/, '');

            // Remove leading attached language tokens (e.g. "pyfrom ...", "jsconsole.log...")
            // Common tokens we see from GPT outputs
            const langTokens = ['py','python','js','javascript','ts','typescript','json','html','css','java','rb','ruby','go','sh','bash','c','cpp','cs','php','rs','swift'];
            try {
              const langRegex = new RegExp('^(' + langTokens.join('|') + ')(?=[A-Za-z_])', 'i');
              out = out.replace(langRegex, '');
            } catch (e) {
              // if regex construction fails for any reason, ignore
            }

            return out;
          };

          contentStr = sanitize(contentStr);
          // If this looks like a Python file, attempt to auto-fix indentation
          const looksLikePythonByExt = (cleanedPath || '').toLowerCase().endsWith('.py');
          const looksLikePythonByContent = /^\s*(from|import|def|class|#|async )\b/m.test(contentStr);

          async function tryAutopep8Fix(src) {
            // Create a temp file and run autopep8 --in-place on it, then return fixed content.
            const tmpName = `gptfilewriter-${Date.now()}-${Math.random().toString(36).slice(2)}.py`;
            const tmpPath = path.join(os.tmpdir(), tmpName);
            try {
              await fs.promises.writeFile(tmpPath, src, 'utf8');

              // Try calling autopep8 CLI first
              try {
                await execFile('autopep8', ['--in-place', tmpPath], { timeout: 10000 });
              } catch (e1) {
                // Fallback to `python -m autopep8` in case autopep8 isn't on PATH
                try {
                  await execFile('python', ['-m', 'autopep8', '--in-place', tmpPath], { timeout: 10000 });
                } catch (e2) {
                  // No autopep8 available; rethrow original so caller can log and continue
                  throw new Error('autopep8 not available: ' + (e2 && e2.message ? e2.message : String(e2)));
                }
              }

              const fixed = await fs.promises.readFile(tmpPath, 'utf8');
              return fixed;
            } finally {
              // best-effort cleanup
              try { await fs.promises.unlink(tmpPath); } catch (e) { /* ignore */ }
            }
          }

          // Only attempt autopep8 when we are reasonably confident this is Python
          if (looksLikePythonByExt || looksLikePythonByContent) {
            try {
              const fixed = await tryAutopep8Fix(contentStr);
              if (fixed && fixed.length > 0) {
                contentStr = fixed;
                logFn(`  🐍 autopep8 applied to ${cleanedPath || '<inline>'}`);
              }
            } catch (err) {
              
            }
          }
        }

        // After sanitization, update the writeData to the sanitized string
        writeData = Buffer.isBuffer(writeData)
          ? Buffer.from(String(contentStr), 'utf8')
          : String(contentStr);

        // Validate content is not empty (based on sanitized string form)
        if (!contentStr || String(contentStr).trim().length === 0) {
          // If filepath is missing (cleanedPath is empty) but the content looks
          // like a license (contains 'MIT License' or 'Copyright'), try to
          // write it to a LICENSE file in the baseDir.
          if (!cleanedPath) {
            const look = (contentStr || '').toLowerCase();
            if (look.includes('mit license') || look.includes('copyright')) {
              cleanedPath = 'LICENSE';
            }
          }

          if (!cleanedPath) {
            logFn(`  ⚠️ Skipping empty file (no path detected)`);
            issues.push({ file: cleanedPath || '<unknown>', issue: 'empty content' });
            continue;
          }
        }

        // If cleanedPath was empty (some parsers omit filepath), ensure we have
        // a sensible filename to write to. Avoid writing to the baseDir itself.
        if (!cleanedPath) cleanedPath = 'file.txt';
        // Recompute targetPath/dir now that cleanedPath may have changed
        if (cleanedPath) {
          // Prevent accidental directory-only targets
          const finalTarget = path.resolve(baseDir, cleanedPath);
          // If finalTarget is the same as baseDir (meaning cleanedPath was '.' or ''),
          // force writing to baseDir/LICENSE if content looks like a license, else file.txt
          if (finalTarget === path.resolve(baseDir)) {
            cleanedPath = (String(contentStr).toLowerCase().includes('mit license')) ? 'LICENSE' : 'file.txt';
          }
        }
        const targetPathFinal = path.resolve(baseDir, cleanedPath);
        const dirFinal = path.dirname(targetPathFinal);
        // Ensure directory exists (again in case we changed filename)
        await fs.promises.mkdir(dirFinal, { recursive: true });

        // Check if content looks truncated (ends abruptly without proper closure)
        const lastLines = contentStr.split('\n').slice(-5).join('\n');
        // If the last few lines do not end with a closing brace/bracket/paren
        // (optionally followed by a semicolon) and the content contains an
        // opening brace, warn that the file may be truncated.
        if (contentStr.length > 100 && !/(}|\]|\))\s*;?$/.test(lastLines) && contentStr.includes('{')) {
          logFn(`  ⚠️ Warning: ${path.relative(baseDir, targetPath)} may be truncated`);
          issues.push({ file: cleanedPath, issue: 'possibly truncated' });
        }

        // Write the FULL content to disk. If writeData is a Buffer, write it as-is
        if (Buffer.isBuffer(writeData)) {
          await fs.promises.writeFile(targetPathFinal, writeData);
        } else {
          await fs.promises.writeFile(targetPathFinal, String(writeData), { encoding: 'utf8', flag: 'w' });
        }

        // Verify the file was written correctly (compare string contents)
        const writtenContent = await fs.promises.readFile(targetPathFinal, 'utf8');
        const stats = await fs.promises.stat(targetPathFinal);
        const actualSize = stats.size;
        const expectedSize = Buffer.byteLength(String(writeData), 'utf8');

        if (String(writtenContent) === String(writeData)) {
          logFn(`  ✅ Wrote: ${path.relative(baseDir, targetPathFinal)} (${actualSize} bytes) - VERIFIED`);
          successCount++;
        } else if (actualSize === expectedSize) {
          logFn(`  ✅ Wrote: ${path.relative(baseDir, targetPathFinal)} (${actualSize} bytes) - size match`);
          successCount++;
        } else {
          logFn(`  ❌ Size mismatch: ${path.relative(baseDir, targetPathFinal)} (expected ${expectedSize}, got ${actualSize})`);
          issues.push({ 
            file: cleanedPath, 
            issue: 'size mismatch',
            expected: expectedSize,
            actual: actualSize
          });
          failCount++;
        }
      
    } catch (err) {
      // Provide a clearer error message including the intended path
      logFn(`  ❌ Failed to write ${path.relative(baseDir, targetPath)}: ${err && err.message ? err.message : String(err)}`);
      issues.push({ file: cleanedPath || '<unknown>', issue: err && err.message ? err.message : String(err) });
      failCount++;
    }
  }

  logFn(`\n📊 Write Summary: ${successCount} successful, ${failCount} failed\n`);
  
  if (issues.length > 0) {
    logFn(`⚠️ Issues found:`);
    issues.forEach(({ file, issue, expected, actual }) => {
      if (expected !== undefined) {
        logFn(`  - ${file}: ${issue} (expected ${expected}, got ${actual})`);
      } else {
        logFn(`  - ${file}: ${issue}`);
      }
    });
    logFn('');
  }

  return { 
    baseDir, 
    written: successCount,
    failed: failCount,
    total: files.length,
    issues 
  };
}

export { writeFilesToDisk };