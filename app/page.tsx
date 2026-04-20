export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <div className="max-w-lg text-center space-y-6">
        <div className="text-6xl font-black tracking-tight">
          NO-FOMO<span className="text-red-500">.</span>AI
        </div>
        <p className="text-gray-400 text-lg">
          כל מה שקרה ב-AI — בלי שתפספס כלום
        </p>
        <div className="mt-8 p-4 bg-gray-900 rounded-xl border border-gray-800 text-left text-sm font-mono space-y-2">
          <div className="text-green-400">✓ Claude API key — מוכן</div>
          <div className="text-yellow-400">⏳ Supabase — ממתין</div>
          <div className="text-yellow-400">⏳ Telegram bot — ממתין</div>
          <div className="text-gray-500 pt-1 text-xs">→ ראה SETUP.md</div>
        </div>
        <p className="text-gray-600 text-xs pt-2">
          NO-FOMO.AI — coming soon
        </p>
      </div>
    </main>
  )
}
