import express from "express";
import axios from "axios";
import * as dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import * as path from "path";
import * as fs from "fs";

process.stdout.on("error", (error: any) => {
  if (error.code === "EPIPE") {
    return;
  }
  console.error("stdout error:", error);
  process.exit(1);
});

const envPath = path.resolve(__dirname, "../.env");
console.error(`[DEBUG] Checking for .env file at: ${envPath}`);
if (fs.existsSync(envPath)) {
  console.error("[DEBUG] .env file found.");
} else {
  console.error("[DEBUG] .env file NOT found.");
}
dotenv.config({ path: envPath });

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } =
  process.env;

const PORT = 4567;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error(
    "ERROR: Spotify client ID or secret is not set in environment variables."
  );
  process.exit(1);
}

let spotifyAccessToken: {
  token: string;
  expires: number;
} | null = null;

async function getSpotifyToken(): Promise<string> {
  if (spotifyAccessToken && spotifyAccessToken.expires > Date.now()) {
    return spotifyAccessToken.token;
  }

  if (!SPOTIFY_REFRESH_TOKEN) {
    throw new Error(
      "SPOTIFY_REFRESH_TOKEN is not set. Please complete the one-time login."
    );
  }

  try {
    const response = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: SPOTIFY_REFRESH_TOKEN,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
          ).toString("base64")}`,
        },
      }
    );

    const { access_token, expires_in } = response.data;
    spotifyAccessToken = {
      token: access_token,
      expires: Date.now() + (expires_in - 300) * 1000,
    };

    return spotifyAccessToken.token;
  } catch (error) {
    console.error("Error refreshing Spotify token:", error);
    throw error;
  }
}

const spotifyApi = axios.create({ baseURL: "https://api.spotify.com/v1" });
const reccoBeatsApi = axios.create({
  baseURL: "https://api.reccobeats.com/v1",
});

async function getUserPlaylists(): Promise<CallToolResult> {
  try {
    const token = await getSpotifyToken();
    const response = await spotifyApi.get("/me/playlists", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const playlists = (response.data.items || []).map((p: any) => ({
      id: p.id,
      name: p.name,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(playlists, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("Error getting user playlists:", error);
    throw error;
  }
}

async function getPlaylistTracks(args: {
  playlist_name: string;
  page?: number;
}): Promise<CallToolResult> {
  try {
    const token = await getSpotifyToken();
    const playlistsResponse = await spotifyApi.get("/me/playlists", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const playlists = (playlistsResponse.data.items || []).map((p: any) => ({
      id: p.id,
      name: p.name,
    }));
    const playlist = playlists.find(
      (p: any) => p.name.toLowerCase() === args.playlist_name.toLowerCase()
    );

    if (!playlist) {
      throw new Error(`Playlist '${args.playlist_name}' not found.`);
    }

    const page = args.page || 1;
    const perPage = 15;
    const offset = (page - 1) * perPage;

    const response = await spotifyApi.get(`/playlists/${playlist.id}/tracks`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { limit: perPage, offset },
    });

    const tracks = (response.data.items || []).map((item: any) => ({
      id: item.track.id,
      name: item.track.name,
      artist: item.track.artists.map((a: any) => a.name).join(", "),
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(tracks, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("Error getting playlist tracks:", error);
    throw error;
  }
}

async function getTrackAudioFeatures(args: {
  track_ids: string[];
}): Promise<CallToolResult> {
  try {
    const response = await reccoBeatsApi.get(
      `/audio-features?ids=${args.track_ids.join()}`
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data.content, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("Error getting track audio features:", error);
    throw error;
  }
}

let oauthServer: any = null;

function startOAuthServerIfNeeded() {
  if (!oauthServer) {
    const app = express();

    app.get("/login", (req, res) => {
      const scopes = "user-read-private user-read-email playlist-read-private";
      const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams(
        {
          response_type: "code",
          client_id: SPOTIFY_CLIENT_ID!,
          scope: scopes,
          redirect_uri: REDIRECT_URI,
        }
      ).toString()}`;
      res.redirect(authUrl);
    });

    app.get("/callback", async (req, res) => {
      const code = req.query.code || null;
      if (!code) {
        return res.status(400).send("Error: No code received from Spotify.");
      }

      try {
        const response = await axios.post(
          "https://accounts.spotify.com/api/token",
          new URLSearchParams({
            grant_type: "authorization_code",
            code: code as string,
            redirect_uri: REDIRECT_URI,
          }),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(
                `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
              ).toString("base64")}`,
            },
          }
        );

        const { access_token, refresh_token } = response.data;
        console.error("\n--- Spotify Authentication Successful ---");
        console.error("Your Access Token (lasts 1 hour):", access_token);
        console.error(
          "\nIMPORTANT: Copy this Refresh Token and save it in your .env file as SPOTIFY_REFRESH_TOKEN"
        );
        console.error("Your Refresh Token:", refresh_token);
        console.error(
          "\n----------------------------------------------------\n"
        );
        res.send(
          "Authentication successful! You can close this window. Check your server console for the refresh token."
        );
      } catch (error) {
        console.error("Error exchanging code for token:", error);
        res.status(500).send("Failed to get token from Spotify.");
      }
    });

    oauthServer = app.listen(PORT, () => {
      console.error(`OAuth server running on http://localhost:${PORT}`);
      console.error(
        `Visit http://localhost:${PORT}/login to perform the one-time authentication.`
      );
    });
  }
}

async function main() {
  try {
    startOAuthServerIfNeeded();

    const mcpServer = new McpServer({
      name: "Spotify MCP Server",
      version: "1.0.0",
      capabilities: {
        resources: {},
        tools: {},
      },
    });

    mcpServer.tool(
      "get_user_playlists",
      "Gets a list of the user's Spotify playlists.",
      {},
      async () => await getUserPlaylists()
    );

    mcpServer.tool(
      "get_playlist_tracks",
      "Gets a paginated list of tracks from a user's specific playlist by name.",
      {
        playlist_name: z.string().describe("The name of the playlist."),
        page: z.number().default(1).describe("The page number to retrieve."),
      },
      async (args: any) => await getPlaylistTracks(args as any)
    );

    mcpServer.tool(
      "get_track_audio_features",
      "Gets the audio features for multiple tracks, given unique IDs.",
      {
        track_ids: z
          .array(z.string())
          .describe("The Spotify IDs of the tracks."),
      },
      async (args: any) => await getTrackAudioFeatures(args as any)
    );

    const transport = new StdioServerTransport();

    await mcpServer.connect(transport);
    console.error("MCP Server connected successfully");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.error("Received SIGINT, shutting down gracefully");
  if (oauthServer) {
    oauthServer.close();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("Received SIGTERM, shutting down gracefully");
  if (oauthServer) {
    oauthServer.close();
  }
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
