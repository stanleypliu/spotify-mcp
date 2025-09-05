import { Mistral } from "@mistralai/mistralai";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const MCP_API_KEY = process.env.MCP_API_KEY || "";

if (!MISTRAL_API_KEY) {
  throw new Error("MISTRAL_API_KEY is not set in environment variables.");
}

const SPOTIFY_BEARER_TOKEN =
  "Bearer BQDKRL3xn4bv5XkPzL1wN84r6GDD6d5YZVzWy0wE7QTPkIO1MFwLSYaeP1ekLyMJzhx5uMCh3WJzgN2Q8VOIfJZKqD4MTSb1bjb77L-GM-PeSYArUeNMcJdJ4bAxCXmUGXafw3Mg8cMWGgW7C_VM-ydf9CVTwo2yUMByStMOxXgN3IpoCrPzm0QcHMUSnIxD9KFgZo1EPv0MtbGfOuBEW5JSF6dZEo_f6m2ibnnbuKqq5Pc";

const mistralClient = new Mistral({apiKey: MISTRAL_API_KEY});
const axiosInstance = axios.create({
  baseURL: "http://localhost:4567/api/v1",
  headers: {
    "X-API-Key": MCP_API_KEY,
    Authorization: SPOTIFY_BEARER_TOKEN,
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
        "Gets the list of all tracks from a user's specific playlist by name.",
      parameters: {
        type: "object",
        properties: {
          playlist_name: {
            type: "string",
            description: "The name of the playlist to fetch tracks from.",
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
    console.log("--- Calling Tool: get_user_playlists ---");
    const { data } = await axiosInstance.get("/playlists");
    return data;
  },
  get_tracks_in_playlist: async (args: { playlist_name: string }) => {
    console.log(
      "--- Calling Tool: get_tracks_in_playlist (name: " + args.playlist_name + ") ---"
    );
    const { data } = await axiosInstance.get("/playlist/tracks", {
      params: { name: args.playlist_name },
    });
    return data;
  },
  get_track_audio_features: async (args: { track_id: string }) => {
    console.log(
      "--- Calling Tool: get_track_audio_features (id: " + args.track_id + ") ---"
    );
    const { data } = await axiosInstance.get(
      `/tracks/${args.track_id}/audio-features`
    );
    return data;
  },
};

async function executeToolCall(
  toolCall: any
): Promise<{ name: string; content: any }> {
  const toolName = toolCall.function.name;
  const toolArgs = JSON.parse(toolCall.function.arguments);
  const toolImplementation = toolImplementations[toolName];

  if (!toolImplementation) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    const toolResult = await toolImplementation(toolArgs);
    console.log("--- Tool Result (Success) ---", toolResult);
    return {
      name: toolName,
      content: JSON.stringify(toolResult),
    };
  } catch (error) {
    console.log(`--- Tool Result (Error) ---`);
    if (axios.isAxiosError(error)) {
      const errorMessage =
        error.response?.data?.error || "An unknown API error occurred.";
      console.error(`Error calling tool ${toolName}:`, errorMessage);
      return {
        name: toolName,
        content: JSON.stringify({ error: errorMessage }),
      };
    }
    throw error;
  }
}

/**
 * This test case simulates the new, more detailed user journey,
 * including proper multi-turn conversation flow and error handling.
 */
async function testConversationalJourney() {
  console.log("\n--- Starting Test: Correct Conversational Journey ---\n");
  const messages: any[] = [];

  let user_prompt = "Can you show me my playlists?";
  console.log(`>>> User: ${user_prompt}`);
  messages.push({ role: "user", content: user_prompt });

  let mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  let assistantMessage = mistralResponse.choices[0].message;
  messages.push(assistantMessage);

  if (assistantMessage.toolCalls) {
    const toolResult = await executeToolCall(assistantMessage.toolCalls[0]);
    const toolCall = assistantMessage.toolCalls[0];
    messages.push({ role: "tool", name: toolResult.name, toolCallId: toolCall.id, content: toolResult.content });
  }

  console.log("--- AI is processing playlist list... ---");
  mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  assistantMessage = mistralResponse.choices[0].message;
  messages.push(assistantMessage);
  console.log(`>>> AI: ${assistantMessage.content}`);

  user_prompt = "Great, can you show me the tracks in 'Workout Jams'?";
  console.log(`>>> User: ${user_prompt}`);
  messages.push({ role: "user", content: user_prompt });

  mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  assistantMessage = mistralResponse.choices[0].message;
  messages.push(assistantMessage);

  if (assistantMessage.toolCalls) {
    const toolResult = await executeToolCall(assistantMessage.toolCalls[0]);
    const toolCall = assistantMessage.toolCalls[0];
    messages.push({ role: "tool", name: toolResult.name, toolCallId: toolCall.id, content: toolResult.content });
  }

  console.log("--- AI is processing the 'playlist not found' error... ---");
  mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  assistantMessage = mistralResponse.choices[0].message;
  messages.push(assistantMessage);
  console.log(`>>> AI: ${assistantMessage.content}`);

   user_prompt = "Okay, my mistake. Please show me the tracks in the first playlist.";
   console.log(`>>> User: ${user_prompt}`);
   messages.push({ role: "user", content: user_prompt });
 
   mistralResponse = await mistralClient.chat.complete({
     model: "voxtral-small-2507",
     messages: messages,
     tools: tools,
   });
   assistantMessage = mistralResponse.choices[0].message;
   messages.push(assistantMessage);
 
   if (assistantMessage.toolCalls) {
     const toolResult = await executeToolCall(assistantMessage.toolCalls[0]);
     const toolCall = assistantMessage.toolCalls[0];
     messages.push({ role: "tool", name: toolResult.name, toolCallId: toolCall.id, content: toolResult.content });
   }

  console.log("--- AI is processing the track list... ---");
  mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  assistantMessage = mistralResponse.choices[0].message;
  messages.push(assistantMessage);
  console.log(`>>> AI: ${assistantMessage.content}`);

  user_prompt = "Perfect, get the audio features for the first track in this playlist.";
  console.log(`>>> User: ${user_prompt}`);
  messages.push({ role: "user", content: user_prompt });

  mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  assistantMessage = mistralResponse.choices[0].message;
  messages.push(assistantMessage);

  if (assistantMessage.toolCalls) {
    const toolResult = await executeToolCall(assistantMessage.toolCalls[0]);
    const toolCall = assistantMessage.toolCalls[0];
    messages.push({ role: "tool", name: toolResult.name, toolCallId: toolCall.id, content: toolResult.content });
  }

  console.log("--- AI is processing the final audio features... ---");
  mistralResponse = await mistralClient.chat.complete({
    model: "voxtral-small-2507",
    messages: messages,
    tools: tools,
  });
  assistantMessage = mistralResponse.choices[0].message;
  console.log(`>>> Final AI Response: ${assistantMessage.content}`);
}

testConversationalJourney();
