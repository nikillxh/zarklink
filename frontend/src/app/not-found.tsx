export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="text-center">
        <h1 className="text-6xl font-bold mb-4">404</h1>
        <p className="text-xl text-gray-400 mb-8">Page not found</p>
        <a
          href="/"
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          Return Home
        </a>
      </div>
    </div>
  );
}
