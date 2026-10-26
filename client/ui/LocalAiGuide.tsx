// What every AI feature tells the DM first: it needs an AI model running on
// their own computer (this site doesn't provide one), and how to set one up
// with Ollama, step by step. Shown wherever an AI feature is offered.

/** The short notice, for next to an AI feature's button. */
export function LocalAiNotice() {
  return (
    <p className="ai-notice small" data-testid="ai-notice">
      <strong>AI features need an AI model running on your own computer.</strong> This site doesn&apos;t provide one. Players don&apos;t need it.
    </p>
  );
}

/** The notice, and the guide to setting up a local AI model. */
export function LocalAiGuide({ open = false }: { open?: boolean }) {
  const origin = location.origin;
  return (
    <div className="ai-guide">
      <p className="ai-notice" role="note" aria-label="About AI features">
        <strong>AI features need an AI model running on your own computer.</strong> This site doesn&apos;t provide one, and nothing you give the AI is sent
        anywhere else. Players never need it: only you, while you set up your game. Start your AI before using these features; it doesn&apos;t have to start
        with your computer.
      </p>
      <details open={open}>
        <summary>How to run a local AI model (free, about 10 minutes)</summary>
        <ol className="ai-steps">
          <li>
            <strong>Install Ollama</strong> from <code>ollama.com</code> (Windows, Mac, or Linux). If it asks you to sign in, choose to use it locally: no
            account is needed.
          </li>
          <li>
            <strong>Download a model.</strong> Open a terminal (on Windows: Start, then type <em>Terminal</em>) and run <code>ollama pull qwen2.5:14b</code>{' '}
            (about 9 GB, best with a graphics card with 12 GB or more). On a smaller computer, use <code>qwen2.5:7b</code> (about 5 GB) instead.
          </li>
          <li>
            <strong>Let this site talk to it</strong> (once). Set <code>OLLAMA_ORIGINS</code> to <code>{origin}</code>:
            <ul>
              <li>
                Windows: Start, type <em>environment variables</em>, open &quot;Edit environment variables for your account&quot;, then New: name{' '}
                <code>OLLAMA_ORIGINS</code>, value <code>{origin}</code>.
              </li>
              <li>
                Mac: in Terminal, run <code>launchctl setenv OLLAMA_ORIGINS &quot;{origin}&quot;</code>.
              </li>
            </ul>
          </li>
          <li>
            <strong>Start it when you want AI help:</strong> run <code>ollama serve</code> in a terminal and leave it open (or open the Ollama app). Close it
            when you&apos;re done; your graphics card is only used while the AI is working.
          </li>
          <li>
            <strong>Connect:</strong> choose Ollama here, press <em>Check connection</em>, and pick your model.
          </li>
        </ol>
        <p className="muted small">LM Studio (lmstudio.ai) works too: start its local server with &quot;Enable CORS&quot; on, and choose LM Studio here.</p>
      </details>
    </div>
  );
}
