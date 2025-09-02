# frozen_string_literal: true

require 'sinatra'
require 'json'
require 'net/http'
require 'uri'
require 'dotenv/load'
require 'rack/cors'

CLIENT_ID = ENV['SPOTIFY_CLIENT_ID']
CLIENT_SECRET = ENV['SPOTIFY_CLIENT_SECRET']
REDIRECT_URI = ENV['SPOTIFY_REDIRECT_URI']
MAX_RECCOBEATS_SIZE = 40

# API Key for the MCP Server
MCP_API_KEY = ENV['MCP_API_KEY']
puts "Server loaded MCP_API_KEY: #{MCP_API_KEY}"

# Before filter for API key authentication
before '/api/*' do

  unless request.env['HTTP_X_API_KEY'] == MCP_API_KEY
    halt 401, { error: 'Unauthorized: Invalid API Key' }.to_json
  end
end

# Allow requests from our Vue frontend.
# In a production environment, you would want to restrict this to your actual domain.
use Rack::Cors do
  allow do
    origins 'http://localhost:8080', 'http://127.0.0.1:8080'
    resource '*', headers: :any, methods: %i[get post options]
  end
end

# Spotify MCP Server
class SpotifyMCPServer
  def initialize(access_token)
    @access_token = access_token
    @spotify_api_base = "https://api.spotify.com/v1"
    @reccobeats_api_request = "https://api.reccobeats.com/v1"
  end

  def random_track
    user_playlists = get_user_playlists
    return nil if user_playlists.empty?

    playlist = user_playlists.sample
    playlist_tracks = get_playlist_tracks(playlist['id'])
    return nil if playlist_tracks.empty?

    playlist_tracks.sample['track']
  end

  def get_playlist_names
    user_playlists = get_user_playlists
    return nil if user_playlists.empty?

    user_playlists.map { |playlist| { playlist['id'] => playlist['name'] } }
  end

  def get_track_names
    user_playlists = get_user_playlists

    tracks = []
    user_playlists.each do |playlist|
      playlist_tracks = get_playlist_tracks(playlist['id'])
      tracks.concat(playlist_tracks.map { |track_item| { track_item['track']['name'] => track_item['track']['id']  } })
    end

    tracks
  end

  def get_track_audio_features(track_name) 
    user_playlists = get_user_playlists

    tracks = []
    user_playlists.each do |playlist|
      playlist_tracks = get_playlist_tracks(playlist['id'])
      tracks.concat(playlist_tracks.map { |track_item| { track_item['track']['name'] => track_item['track']['id']  } })
    end

    return { error: "No tracks found in playlists for genre '#{genre}'." } if track_ids.empty?

    found_track = tracks.find { |track| track.key?(track_name) }

    return { error: "Couldn't find any track with that name in any of your playlists." } if found_track.nil?
  end

  def track_recommendation(genre, mood)
    user_playlists = get_user_playlists
    return { error: "No playlists found for this user." } if user_playlists.empty?

    genre_playlists = user_playlists.select do |playlist|
      playlist['name'].downcase.include?(genre.downcase)
    end

    return { error: "No playlists found for genre '#{genre}'." } if genre_playlists.empty?

    track_ids = []
    genre_playlists.each do |playlist|
      playlist_tracks = get_playlist_tracks(playlist['id'])
      track_ids.concat(playlist_tracks.map { |track_item| track_item['track']['id'] })
    end

    return { error: "No tracks found in playlists for genre '#{genre}'." } if track_ids.empty?

    mood_params = case mood.downcase
    when 'happy'
      { min_valence: 0.7, min_energy: 0.7 }
    when 'sad'
      { max_valence: 0.3, max_energy: 0.3 }
    when 'energetic'
      { min_energy: 0.8 }
    when 'calm'
      { max_energy: 0.4 }
    else
      {}
    end

    audio_features_map = {}
    track_ids.each_slice(MAX_RECCOBEATS_SIZE) do |batch|
      audio_features_list = get_audio_features_for_tracks(batch)

      audio_features_list.each do |audio_features|
        id = audio_features['href'].split('/')[-1]
        audio_features_map[id] = audio_features if audio_features
      end
    end

    track_ids.each do |track_id|
      audio_features = audio_features_map[track_id]
      next unless audio_features

      if meets_mood_criteria?(audio_features, mood_params)
        return get_track(track_id)
      else
        puts "Track '#{get_track(track_id)['name']}' did not meet mood criteria. Audio features: #{audio_features.inspect}"
      end
    end

    { error: "No track found for genre '#{genre}' and mood '#{mood}'" }
  end

  def get_user_playlists
    response = spotify_api_request("/me/playlists")
    response['items'] || []
  end

  def get_playlist_tracks(playlist_id)
    tracks = []
    url = "/playlists/#{playlist_id}/tracks?limit=100"
    while url
      response = spotify_api_request(url)
      tracks.concat(response['items'] || [])
      url = response['next'] ? response['next'].gsub(@spotify_api_base, '') : nil
    end
    tracks
  end

  private

  def get_audio_features_for_tracks(track_ids)
    response = reccobeats_api_request("/audio-features?ids=#{track_ids.join(',')}")
    response['content'] || []
  end

  def get_track(track_id)
    spotify_api_request("/tracks/#{track_id}")
  end

  def meets_mood_criteria?(audio_features, mood_params)
    return false unless audio_features

    mood_params.all? do |param, value|
      feature = case param
      when :min_valence, :max_valence
        audio_features['valence']
      when :min_energy, :max_energy
        audio_features['energy']
      end

      return false unless feature

      case param
      when :min_valence, :min_energy
        feature >= value
      when :max_valence, :max_energy
        feature <= value
      else
        true
      end
    end
  end

  def spotify_api_request(endpoint)
    uri = URI.parse("#{@spotify_api_base}#{endpoint}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    
    request = Net::HTTP::Get.new(uri.request_uri)
    request['Authorization'] = "Bearer #{@access_token}"
    
    response = http.request(request)
    
    if response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body)
    else
      puts "Error from Spotify API: #{response.body} - endpoint #{endpoint}"
      {}
    end
  end

  def reccobeats_api_request(endpoint)
    uri = URI.parse("#{@reccobeats_api_request}#{endpoint}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    
    request = Net::HTTP::Get.new(uri.request_uri)
    
    response = http.request(request)
    
    if response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body)
    else
      puts "Error from Reccobeats API: #{response.body} - endpoint #{endpoint}"
      {}
    end
  end
end

get '/' do
  content_type :json
  { status: 'running' }.to_json
end

get '/callback' do
  content_type :json
  auth_code = params['code']

  unless auth_code
    status 400
    return { error: 'Authorization code not found' }.to_json
  end

  uri = URI.parse('https://accounts.spotify.com/api/token')
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true

  request = Net::HTTP::Post.new(uri.request_uri)
  request.basic_auth(CLIENT_ID, CLIENT_SECRET)
  request.set_form_data(
    'grant_type' => 'authorization_code',
    'code' => auth_code,
    'redirect_uri' => REDIRECT_URI
  )

  response = http.request(request)

  if response.is_a?(Net::HTTPSuccess)
    response.body
  else status response.code.to_i response.body
  end
end

get '/api/v1/track-recommendation' do
  content_type :json

  auth_header = request.env['HTTP_AUTHORIZATION']
  unless auth_header&.start_with?('Bearer ')
    status 401
    return { error: 'Access token not found' }.to_json
  end

  access_token = auth_header.split(' ').last
  mcp_server = SpotifyMCPServer.new(access_token)

  genre = params['genre']
  mood = params['mood']

  unless genre && mood
    status 400
    return { error: 'Genre and mood parameters are required' }.to_json
  end

  track = mcp_server.track_recommendation(genre, mood)

  if track && track[:error]
    status 404
    { error: track[:error] }.to_json
  else
    { track: track }.to_json
  end
end

get '/api/v1/random-track' do
  content_type :json

  auth_header = request.env['HTTP_AUTHORIZATION']
  unless auth_header&.start_with?('Bearer ')
    status 401
    return { error: 'Access token not found' }.to_json
  end

  access_token = auth_header.split(' ').last
  mcp_server = SpotifyMCPServer.new(access_token)
  track = mcp_server.random_track

  if track
    { track: track }.to_json
  else
    status 404
    { error: 'Could not find a random track. Ensure the user has playlists and they are not empty.' }.to_json
  end
end

set :bind, '0.0.0.0'
