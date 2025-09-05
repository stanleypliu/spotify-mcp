import { Mistral } from "@mistralai/mistralai";
import axios from "axios";
import * as dotenv from "dotenv";
import * as readline from "readline";

dotenv.config();

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const MCP_API_KEY = process.env.MCP_API_KEY || "";

if (!MISTRAL_API_KEY) {
  throw new Error("MISTRAL_API_KEY is not set in environment variables.");
}

const SPOTIFY_BEARER_TOKEN = process.env.SPOTIFY_BEARER_TOKEN || "";
if (!SPOTIFY_BEARER_TOKEN) {
  throw new Error("SPOTIFY_BEARER_TOKEN is not set in environment variables.");
}

const mistralClient = new Mistral({ apiKey: MISTRAL_API_KEY });
const axiosInstance = axios.create({
  baseURL: "http://localhost:4567/api/v1",
  headers: {
    "X-API-Key": MCP_API_KEY,
    Authorization: `Bearer ${SPOTIFY_BEARER_TOKEN}`,
  },
});

const tools: any[] = [
  {
    type: "function",
    function: {
      name: "get_user_playlists",
      description: "Gets a list of the user's playlists.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tracks_in_playlist",
      description:
        "Gets a paginated list of tracks from a user's specific playlist by name.",
      parameters: {
        type: "object",
        properties: {
          playlist_name: {
            type: "string",
            description: "The name of the playlist to fetch tracks from.",
          },
          page: {
            type: "integer",
            description: "The page number of tracks to retrieve.",
            default: 1,
          },
        },
        required: ["playlist_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_track_audio_features",
      description:
        "Gets the audio features for a single track, given a specific and unique track ID.",
      parameters: {
        type: "object",
        properties: {
          track_id: {
            type: "string",
            description: "The unique Spotify ID of the track.",
          },
        },
        required: ["track_id"],
      },
    },
  },
];

const toolImplementations: any = {
  get_user_playlists: async () => {
    const { data } = await axiosInstance.get("/playlists");
    return data;
  },
  get_tracks_in_playlist: async (args: { playlist_name: string; page?: number }) => {
    const { data } = await axiosInstance.get("/playlist/tracks", {
      params: { name: args.playlist_name, page: args.page || 1 },
    });
    return data;
  },
  get_track_audio_features: async (args: { track_id: string }) => {
    const { data } = await axiosInstance.get(
      `/tracks/${args.track_id}/audio-features`
    );
    return data;
  },
};

async function executeToolCall(toolCall: any): Promise<{ name: string; content: any; id: string }> {
  const toolName = toolCall.function.name;
  const toolArgs = JSON.parse(toolCall.function.arguments);
  const toolImplementation = toolImplementations[toolName];

  if (!toolImplementation) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    const toolResult = await toolImplementation(toolArgs);
    return {
      name: toolName,
      id: toolCall.id,
      content: JSON.stringify(toolResult),
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage =
        error.response?.data?.error || "An unknown API error occurred.";
      return {
        name: toolName,
        id: toolCall.id,
        content: JSON.stringify({ error: errorMessage }),
      };
    }
    throw error;
  }
}

async function callMistral(messages: any[]) {
  const mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  return mistralResponse.choices[0].message;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const messages: any[] = [];

  console.log("Welcome to the Mistral Spotify Client! Type 'exit' to quit.");

  const chatLoop = async () => {
    rl.question(">>> User: ", async (userInput) => {
      if (userInput.toLowerCase() === "exit") {
        rl.close();
        return;
      }

      messages.push({ role: "user", content: userInput });

      try {
        let assistantMessage = await callMistral(messages);
        messages.push(assistantMessage);

        if (assistantMessage.toolCalls) {
          const toolCall = assistantMessage.toolCalls[0];
          const toolResult = await executeToolCall(toolCall);
          messages.push({ role: "tool", name: toolResult.name, toolCallId: toolResult.id, content: toolResult.content });

          assistantMessage = await callMistral(messages);
          messages.push(assistantMessage);
        }

        console.log(`>>> AI: ${assistantMessage.content}`);
      } catch (error) {
        console.error("\nAn error occurred:", error);
        messages.pop();
      }

      chatLoop();
    });
  };

  chatLoop();
}

main();
