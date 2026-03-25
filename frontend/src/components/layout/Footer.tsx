export default function Footer() {
  return (
    <footer className="px-6 py-8 mt-16 text-center text-xs"
      style={{ color: 'var(--text-tertiary)', borderTop: '1px solid var(--border)', fontFamily: 'var(--font-dm-mono)' }}>
      © {new Date().getFullYear()} Photography Portfolio
    </footer>
  );
}
