# DP-1 Publisher Dashboard

A web dashboard for publishing DP-1 playlists and channels to the feed server using wallet-based authentication.

## Features

- **Wallet Connection**: Connect Ethereum wallet (mainnet only) for signature-based authentication
- **Publish Playlists**: Create playlists from scratch with multiple items and curator support
- **Dynamic Playlists**: Support for playlists extension v0.1.0 with dynamic item fetching via `dynamicQuery`
- **Intermission Notes**: Add optional artist-authored notes at playlist and item levels for intermission cards
- **Publish Channels**: Create channels that reference existing playlists
- **JSON Editor**: Paste complete JSON documents or build via forms
- **URI Validation**: Security checks and reachability verification for playlist URIs
- **DP-1 Compliant**: Full EIP-191 signing with DID:PKH format

## Tech Stack

- **Frontend**: Vite + React + TypeScript
- **Web3**: wagmi + viem
- **UI**: Tailwind CSS + shadcn/ui
- **Signing**: EIP-191 personal message signing
- **Feed Server**: https://feed.feralfile.com

## Getting Started

### Prerequisites

- Node.js 22.10+ and npm
- Ethereum wallet (MetaMask, WalletConnect, etc.)
- Access to Ethereum mainnet

### Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# (Optional) Add WalletConnect Project ID to .env
# Get one from https://cloud.walletconnect.com/
```

### Development

```bash
# Start development server
npm run dev

# Open http://localhost:5173
```

### Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### Docker

The image is a multi-stage build: Node compiles the Vite app, then nginx serves static files from `dist/`. Base images are pinned with **tags and digests** in the `Dockerfile` so rebuilds stay consistent until you intentionally upgrade Node or nginx. The compile stage uses the full `node:…-bookworm` image (not `-slim`) so dependencies with native bindings can build during `npm ci`.

**Quick start**

```bash
# Build (defaults match `.env.example`: public feed URL, empty WalletConnect ID)
docker build -t ff-publisher .

# Run on http://localhost:8080
docker run --rm -p 8080:80 ff-publisher
```

**Build-time configuration** (Vite embeds these into the static bundle):

```bash
docker build -t ff-publisher \
  --build-arg VITE_FEED_BASE_URL=https://feed.feralfile.com \
  --build-arg VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id \
  .
```

**Upgrading pinned images**

When you want a newer Node or nginx, choose tags on [Docker Hub](https://hub.docker.com/), refresh the digest for each `FROM` line (see the comment at the top of `Dockerfile`), and run a local build to confirm.

## Usage

### Publishing a Playlist

1. **Connect Wallet**: Click "Connect Wallet" and connect your Ethereum mainnet wallet
2. **Switch to Playlist Tab**: Navigate to "📋 Publish Playlist"
3. **Fill Form**:
   - Enter title (required)
   - Optionally customize slug, summary, cover image
   - Optionally add intermission note (shown before playlist starts)
   - Configure default display settings (scaling, license, duration, etc.)
   - Add playlist items (source URI required for each) OR enable Dynamic Query
     - Each item can have an optional intermission note shown after it
   - If using Dynamic Query:
     - Enable the "Dynamic Query" toggle
     - Configure profile, endpoint, method, headers, and query
     - Set response mapping (items path, schema, field mapping)
   - Add additional curators if needed
4. **Sign & Publish**: Click "Sign & Publish" to sign with your wallet and publish

**OR** use JSON Editor:

1. Switch to "JSON Editor" tab
2. Paste complete playlist JSON
3. Click "Sign & Publish"

### Publishing a Channel

1. **Connect Wallet**: Ensure wallet is connected (Ethereum mainnet)
2. **Switch to Channel Tab**: Navigate to "📺 Publish Channel"
3. **Fill Form**:
   - Enter title (required)
   - Optionally customize slug, version, summary, cover image
   - Enter your publisher name and URL
   - Add curators if needed (optional)
   - Paste playlist URIs (one per line)
4. **Validate URIs**: Click "Validate URIs" to check format and reachability
5. **Sign & Publish**: Click "Sign & Publish" to sign and publish

## Architecture

### Signing Flow

Based on `dp1-go/sign/payload.go`:

1. **Strip signatures**: Remove `signature` and `signatures` fields from JSON
2. **Canonicalize**: Apply JCS (JSON Canonicalization Scheme)
3. **Construct signing message**: Append `\n` to canonical JSON
4. **Hash**: Compute SHA-256 digest
5. **Sign**: Use EIP-191 personal_sign with the digest
6. **Format**: Construct signature object with:
   - `alg`: "eip191"
   - `kid`: "did:pkh:eip155:1:{checksummed-address}"
   - `ts`: RFC3339 timestamp
   - `payload_hash`: "sha256:{hex-digest}"
   - `role`: "curator" | "publisher"
   - `sig`: base64url-encoded signature (no padding)

### Slug Generation

Based on `dp1-feed-v2/internal/executor/executor.go`:

```typescript
function generateSlug(title: string, id: string, userSlug?: string): string {
  if (userSlug) return slugify(userSlug);
  const base = slugify(title) || 'playlist';
  const shortId = id.slice(0, 8); // First 8 chars of UUID
  return `${base}-${shortId}`;
}
```

## API Endpoints

- **POST** `/api/v1/playlists` - Create playlist
- **POST** `/api/v1/channels` - Create channel
- **GET** `/api/v1/playlists/{id}` - Get playlist

Authentication: Signature-based (no API key required)

## Security

- Only `https://` and `ipfs://` URIs allowed for playlists
- Private/local URIs blocked (localhost, 127.x.x.x, 192.168.x.x, 10.x.x.x)
- EIP-191 signature verification on server
- DID:PKH format for key identifiers

## License

See [LICENSE](LICENSE) file.
