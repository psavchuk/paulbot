const { Client, Intents, MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');

const {
    sqlEnabled,
    prefix,
} = require('./config.json');

const {
    token,
    sqlPassword,
} = require('./secret.json');

const {
    lfmapikey,
    lfmsecret,
} = require('./lastfm.json');

const ytdl = require('ytdl-core-discord');
const youtubesr = require("youtube-sr").default;
const ytpl = require('ytpl');
const ytmix = require('yt-mix-playlist');

const scdl = require('soundcloud-downloader').default;

const strsimilarity = require('string-similarity');

const mysql = require("mysql2");

// https://stackoverflow.com/a/71607743 jumping to time

const LastFMTyped = require("lastfm-typed");
const lfm = new LastFMTyped.default(lfmapikey, {apiSecret: lfmsecret});

const {
	AudioPlayerStatus,
	StreamType,
	createAudioPlayer,
	createAudioResource,
	joinVoiceChannel,
    VoiceConnection,
} = require('@discordjs/voice');

const hlprFncs = require('./code/helper-functions');

//discord client settings
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_VOICE_STATES] });
//discord voice connection
let connection = VoiceConnection;
//sql connection settings (@TODO make this optional)
const mySQLConnection = mysql.createConnection({
    host     : 'localhost',
    user     : 'root',
    password : sqlPassword,
    database : 'paulbot_db'
});

const queue = [];
const player = createAudioPlayer();
let playerStatus = AudioPlayerStatus.Idle;
let channel; // stores discord text channel
let voiceChannel; // stores discord voice channel


let currentSong; // stores current song for looping purposes
let pauseEnabled = false; //whether current song is paused or not
let loopEnabled = false; //whether current song will be looped or not
let autoplayEnabled = false;

const autoplayMaxLength = 1; //length of autoplay playlist
const maxAutoplaySongLength = 600; //max length of a song before we skip it (so we don't get hour long loops, etc)

let autoplaySongs = [];
let autoplaySimilarityThreshold = 0.75;
let autoplayOriginalSong; //stores the song our autoplay is based off of
const autoplayWordBlacklist = ["live", "performance", "gma", "show", "perform", "late", "react", "award", "gameplay", "saber", "album", "hour", "ceremony", "fmv", "cinematic", "new", "mv"]; //stores words that should be skipped by autoplay
const symbolRegex = new RegExp(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/, 'g');
const parenthesisRegex = new RegExp(/\(([^()]+)\)/, 'g');
const bracketRegex = new RegExp(/\[([^\[\]]+)\]/, 'g');
const videoIdRegex = new RegExp(/(?<=v=\s*).*?(?=\s*&)/, 'g');
const titleRegexList = ["music", "lyric", "video", "official"];

let playedSongs = []; //stores names of played songs for autoplay to compare against
let playedSongsLength = 50; //max length of played songs before we stop storing (don't want to store too many for memory sake)

let currentPlayingMessage; // stores variable for the message with controls
let currentSearchingMessage; // stores variable for the 'searching' message

const autoplayButtonID = 2;
const playButtonID = 0;
const loopButtonID = 0;
const clearButtonID = 1;

let playSongAttempts = 0;

// youtube mix autoplay variables
let ytmixIndex = -1;
let maxytmixIndex = 50;
let mixPlaylist;

const headerRow = new MessageActionRow().addComponents([new MessageButton()
                                                            .setCustomId('play')
                                                            .setLabel('Pause')
                                                            .setStyle('SECONDARY'),
                                                        new MessageButton()
                                                            .setCustomId('skip')
                                                            .setLabel('Skip')
                                                            .setStyle('SECONDARY'),
                                                        new MessageButton()
                                                            .setCustomId('autoplay')
                                                            .setLabel('Enable Autoplay')
                                                            .setStyle('SECONDARY'),
                                                        new MessageButton()
                                                            .setCustomId('favorite')
                                                            .setEmoji('❤️')
                                                            .setStyle('SECONDARY'),
                                                        new MessageButton()
                                                            .setCustomId('more')
                                                            .setLabel('. . .')
                                                            .setStyle('SECONDARY')
                                                        ]);

const moreRow = new MessageActionRow()
                        .addComponents([
                            new MessageButton()
                                .setCustomId('loop')
                                .setLabel('Start Loop')
                                .setStyle('SECONDARY'),
                            new MessageButton()
                                .setCustomId('clear')
                                .setLabel('Clear Queue')
                                .setStyle('DANGER'),
                            new MessageButton()
                                .setCustomId('less')
                                .setLabel('. . .')
                                .setStyle('SUCCESS')
                        ]);

const embedColor = '#ffffff'; //used to change color of the embed
const baseEmbed = new MessageEmbed().setColor(embedColor); //the embed we change for every new song
const autoplayEmbed = new MessageEmbed().setColor(embedColor);

//initial client commands
client.once('ready', () => {
    if(sqlEnabled) {
        try {
            mySQLConnection.connect();
        } catch (error) {
            console.log("Error connecting to SQL Database", e);
            mySQLConnection.destroy();
            sqlEnabled = false;
        }
    }
    
    console.log('Ready!', client.user.username);
});

client.once('reconnecting', () => {
    console.log('Reconnecting!');
});

client.once('disconnect', () => {
    console.log('Disconnect!');
});

//process user messages
client.on('messageCreate', async message => {
    // ignore messages made by the bot itself
    if (message.author.bot) return;

    let content = message.content.toLowerCase(); 

    if (!content.startsWith(prefix)) return;

    if(!channel)
        channel = message.channel;

    if(content.startsWith(`${prefix}join`)) //join command
    {
        if(message.member.voice.channel) //if in channel
        {
            voiceChannel = message.member.voice.channel;
            join(voiceChannel);
        }
        return;
    }

    if(content.startsWith(`${prefix}leave`)) //leave command
    {
        leave();
        return;
    }

    if(content.startsWith(`${prefix}pause`)) //pause command
    {
        pause(true);
        return;
    }

    if(content.startsWith(`${prefix}resume`)) //resume command
    {
        resume(true);
        return;
    }

    if(content.startsWith(`${prefix}skip`)) //skip command
    {
        skip();
        return;
    }

    if(content.startsWith(`${prefix}clear`)) //clear queue command
    {
        clear(true);
        return;
    }

    if(content.startsWith(`${prefix}play`)) //play command
    {
        // join the channel if we are not in it already
        if(message.member.voice.channel !== voiceChannel)
        {
            voiceChannel = message.member.voice.channel;
            join(voiceChannel);
        }

        play(message);
        return;
    }
});

async function join(channel) {
    // establish voice connection
    connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    baseEmbed.setThumbnail(channel.guild.iconURL());
}

async function leave() {
    if(typeof connection !== 'undefined') //if connection exists
    {
        playerStatus = AudioPlayerStatus.Idle;
        connection.destroy();
    }
}

async function autoplaySelector(song, mode="youtube-mix") {
    if(!autoplayEnabled)
        return;

    if(autoplaySongs.length >= autoplayMaxLength)
        autoplaySongs.shift();

    if(mode == "lastfm") {
        let related_tracks;

        try {
            // if artist is filled then it is likely last fm already found this song before, and we don't have to search for it again
            if(song.artist != "") {
                related_tracks = await lfm.track.getSimilar({ track: song.name, artist: song.artist }, { limit: 10, username:"woozless" } );
            }
            else {
                // else we have to find the track manually
                const tracks = await lfm.track.search(song.name, { limit: 5, username: "woozless"});
                // sort tracks by most listeners to find most reliable match (last fm has a lot of variants on songs)
                const tracks_sorted = tracks.trackMatches.sort((a, b) => (parseInt(a.listeners) < parseInt(b.listeners)) ? 1 : -1)
                const track = tracks_sorted[0];
                // search for related tracks to the song we just found
                related_tracks = await lfm.track.getSimilar({ track: track.name, artist: track.artist }, { limit: 10, username:"woozless" } );
            }
        } catch (error) {
            console.log(error);
        }

        if(related_tracks != null && related_tracks.tracks.length > 1) {
            const _tracks = related_tracks.tracks;
            const length = _tracks.length;

            for (let i = 0; i < length; i++) {

                // get random track weighted by 'match' value of the track
                const randomNum = weightedRandom(_tracks);

                const _track = _tracks[randomNum];

                // try to add song to autoplay queue
                const result = await addAutoplaySong(_track);

                if(result == true) {
                    return;
                }
                else {
                    // if not get rid of song and try next one
                    _tracks.splice(randomNum, 1);
                    continue;
                }
            }
        }
    }

    if (mode == "youtube-mix") {
        // when index is -1 we know that we need a new mix / playlist
        if(ytmixIndex == -1) {
            if (song.url && song.mode == "ytdl") {
                autoplayOriginalSong = song;
                mixPlaylist = await ytmix(song.url, { hl: 'en', gl: 'US' });
            }

            ytmixIndex = 0;
        }

        if(mixPlaylist) {
            maxytmixIndex = mixPlaylist.items.length - 1;
            ytmixIndex ++;

            // if we've reached end of items
            if(ytmixIndex >= maxytmixIndex || typeof mixPlaylist.items[ytmixIndex] === 'undefined') 
            {
                console.log("reached end of playlist");
                
                const mixSong = mixPlaylist.items[ytmixIndex - 1];
                ytmixIndex = -1;

                autoplaySelector({
                    url: mixSong.id,
                    mode: "ytdl",
                    name: mixSong.title,
                    artist: "",
                });

                return;
            }
                
            const mixSong = mixPlaylist.items[ytmixIndex];

            if(checkForPlayedSong(mixSong.title)) {
                // the song has been played already, try again
                autoplaySelector({
                    url: mixSong.id,
                    mode: "ytdl",
                    name: mixSong.title,
                    artist: "",
                });

                return;
            }
            else {
                // we have found a new song yay
                // store it in sql database
                if(sqlEnabled)
                {
                    const _date = new Date();

                    // first add the song to `songs` table if its not there already
                    addSongToDatabase(mixSong.id, mixSong.title, mixSong.author.name, _date);
                    // then add the song to `songs autoplayed` table
                    addAutoplayedSongToDatabase(mixSong.id, autoplayOriginalSong.url, _date);
                    // then update last played 
                    updateSongLastPlayedDatabase(mixSong.id, _date);
                    // then update times played
                    updateSongTimesPlayedDatabase(mixSong.id, true);
                }
                // then push it to our queue
                autoplaySongs.push({
                    url: mixSong.id,
                    mode: "ytdl",
                    name: mixSong.title,
                    artist: "",
                });
    
                return;
            }
        }
    }

    // use youtube as backup if we get this far
    const resp = await ytdl.getInfo(song.url);
    related_videos = resp.related_videos;

    related_videos.sort((a, b) => (parseInt(a.view_count) < parseInt(b.view_count)) ? 1 : -1); // sort by views

    for (let i = 0; i < related_videos.length; i++) {
        const element = related_videos[i];
    
        const title = titleClear(element.title.toLowerCase());

        if(autoplayCheckBlacklist(title, "")) //skips over if word is on blacklist
            continue;
    
        if(element.length_seconds <= maxAutoplaySongLength) {         
            console.log("title of autoplay song: ", title);  

            if(checkForPlayedSong(title)) {
                console.log("has song been played already");
                continue;
            }

            // check again if the list is too long
            if (autoplaySongs.length >= autoplayMaxLength)
                autoplaySongs.shift();

            // adds song to autoplay list
            autoplaySongs.push({
                url: element.id, 
                mode: "ytdl",
                name: title,
                artist: "",
            });
            break;
        }

    }

}

async function addAutoplaySong(_track) {
    const title = _track.name;
    const author = _track.artist.name;
    
    if(checkForPlayedSong(title)) {
        console.log("has song been played already");
        return false;
    }

    console.log("title of autoplay song: ", title);  

    if (autoplaySongs.length >= autoplayMaxLength)
        autoplaySongs.shift();

    const trackInfo = await youtubesr.searchOne(`${author} ${title}`);

    if(trackInfo) {
        autoplaySongs.push({
            url: trackInfo.id,
            mode: "ytdl",
            name: title,
            artist: author,
        });

        return true;
    }
    else {
        return false;
    }
}

function weightedRandom(tracks) {
    const r = Math.random();
    let xmax = 0;
    let curX = 0;

    const matches = tracks.map(function(x) {
        xmax += x.match;
        return x.match;
    });


    for (let i = 0; i < matches.length; i++) {
        const element = matches[i];
        
        if(r < ((element + curX) / xmax))
        {
            return i;
        }
        else {
            curX += element;
            continue;
        }
    }
    
    return 0;
}

//returns true if word is in blacklist and false if not
function autoplayCheckBlacklist(title, author) {
    title = title.replace(symbolRegex, '');
    
    for (let i = 0; i < autoplayWordBlacklist.length; i++) {
        const element = autoplayWordBlacklist[i];
        let _regExp = new RegExp(`(${element})`, 'g');

        if(_regExp.test(title)) {
            console.log("Found black list word in title! " + element);
            return true;
        }
    }

    return false;
}

//clears title of random symbols and other nonsense
function titleClear(title, clearParenthesis = true) {
    if (title) {

        title = title.toLowerCase();

        if(clearParenthesis)
        {
            title = title.replace(parenthesisRegex, '');
            title = title.replace(bracketRegex, '');
        }
            

        title = title.replace(symbolRegex, '');
    
        for (let i = 0; i < titleRegexList.length; i++) {
            const element = new RegExp(`(${titleRegexList[i]})`);
            title = title.replace(element, '');
        } 
    }

    return title;
}

// magic happens here
async function play(message) {
    // reset the mix autoplay
    ytmixIndex = -1;

    const args = message.content.split(" "); //split the message on spaces
    args.shift(); //removes first element (such as the command !play)

    let searchQuery = args.join(" "); //puts it back together without first element

    if(searchQuery == "") { //if there was nothing else with the !play command
        if(playerStatus == AudioPlayerStatus.Paused) {
            resume();
        }

        return;
    }

    currentSearchingMessage = await message.channel.send(`${client.user.username}` + ' is searching for your request...');

    let songInfo;

    // handle links
    //check if url or not
    if(hlprFncs.isValidHttpUrl(searchQuery)) {
        //#region soundcloud links
        if(searchQuery.includes('soundcloud.com')) //could be better way of checking if it is soundcloud
        {
            try {
                songInfo = await scdl.getInfo(searchQuery);

                if(songInfo) {
                    if (currentSearchingMessage) {
                        currentSearchingMessage.delete(); //replace our search message
                    }
                    
                    message.channel.send(`${client.user.username}` + ' found ' + "**" + `${songInfo.title}` + "**");

                    queue.push({
                        url: searchQuery,
                        mode: "scdl",
                        name: "",
                        author: "",
                    });
            
                    if(playerStatus == AudioPlayerStatus.Idle){
                        skip(); //cheaty code
                    }
                }

            } catch (error) {
                console.log(error);
            }

            return;
        }
        //#endregion soundcloud

        //#region youtube playlists
        if(searchQuery.includes('playlist') || searchQuery.includes('list'))
        {
            playYoutubePlaylist(message, searchQuery);
            return;
        }
        //#endregion

        // extract id from url
        // @TODO handle time parameter?
        if(searchQuery.includes('youtube.com'))
        {
            searchQuery = String(searchQuery).split('?v=')[1].split('&')[0];
        }

        if(searchQuery.includes('youtu.be'))
        {
            searchQuery = String(searchQuery).split('.be/')[1].split('?')[0];
        }
        
    }
    else //not a link 
    {
        console.log("invalid url, searching for query");
    }

    try {
        const results = await youtubesr.searchOne(searchQuery);
        songInfo = results;
    } catch (error) {
        console.log(console.log("error searching youtube for song"), error);
    }

    try {
        if(songInfo) {
            // dataSheet.AddRow(songInfo.id, songInfo.title, songInfo.channel.name, new Date().toLocaleDateString(), message.author.username, message.author.id);
            if(sqlEnabled) {
                const _date = new Date();
                // store song that played
                addSongToDatabase(songInfo.id, songInfo.title, songInfo.channel?.name, _date);
                // update last time this song has been played
                updateSongLastPlayedDatabase(songInfo.id, _date);
                updateSongTimesPlayedDatabase(songInfo.id);

                console.log(parseInt(message.author.id));

                // below code removed for privacy reasons
                // store user that played
                // mySQLConnection.execute(
                //     "INSERT INTO `paulbot_db`.`users` (`idUser`, `nameUser`) values (?, ?)",
                //     [parseInt(message.author.id), message.author.username],
                //     function(err, results, fields) {
                //         if(err)
                //             console.log("sql error caught", err);
                //     }
                // );

                // store song in relation to person that played it
                // mySQLConnection.execute(
                //     "INSERT INTO `paulbot_db`.`songs played` (`idUser`, `idSong`, `datePlayed`) values (?, ?, ?)",
                //     [parseInt(message.author.id), songInfo.id, hlprFncs.getSQLDate(new Date())],
                //     function(err, results, fields) {
                //         if(err)
                //             console.log("sql error caught", err);
                //     }
                // );
            }

            message.channel.send(`${client.user.username}` + ' found ' + "**" + `${songInfo.title}` + "**");

            if (currentSearchingMessage) {
                currentSearchingMessage.delete();
            }

            queue.push({
                url: songInfo.id,
                mode: "ytdl",
                name: titleClear(songInfo.title),
                artist: "",
            });

            if(playerStatus == AudioPlayerStatus.Idle){
                skip(); //cheaty code
            }
        }
        else //error retrieving
        {
            message.channel.send(`${client.user.username}` + ' could not find ' + "**" + `${searchQuery}` + "**");
        }
    } catch (error) {
        console.warn(error);
        message.channel.send(`${client.user.username}` + ' could not play ' + "**" + `${searchQuery}` + "**" + " " + error);
    }
    
}

async function addYoutubeUrlToQueue(url) {
    try {
        let songInfo;

        const results = await youtubesr.searchOne(url);
        songInfo = results;

        if(songInfo) {
            queue.push({
                url: songInfo.id,
                mode: "ytdl",
                name: titleClear(songInfo.title),
                artist: "",
            });
        }

        if(playerStatus == AudioPlayerStatus.Idle){
            skip(); //cheaty code
        }
        
    } catch (error) {
        console.log(error);
        songInfo = null;
    }
}

async function playYoutubePlaylist(message, url)
{
    try {
        const isValid =  await ytpl.validateID(url);
        console.log(isValid);

        if(isValid) {
            const playlistInfo = await ytpl(url);

            if(playlistInfo) {
                message.channel.send(`${client.user.username}` + " has added " + "**" + `${playlistInfo.items.length}` + "**" + " songs");
    
                for (let i = 0; i < playlistInfo.items.length; i++) {
                    const element = playlistInfo.items[i];

                    queue.push({
                        url: element.id,
                        mode: "ytdl",
                        name: titleClear(element.title),
                        artist: "",
                    });
                }
    
                if(playerStatus == AudioPlayerStatus.Idle){
                    skip(); //cheaty code
                    return;
                }
    
                setEmbedAuthor(true);
                return;
            }
        }

        // if we get this far it must be a mix, right??
        playIDFromMixURL(message, url);
        message.channel.send(`${client.user.username}` + ' cannot play mixes atm sry :( ');
    } catch (error) {
        console.warn(error);
        message.channel.send(`${client.user.username}` + ' could not play ' + "**" + `${url}` + "**" + " " + error);
    }
}

async function playIDFromMixURL(message, url) {
    try {
        const id = url.match(videoIdRegex)[0];
        console.log(id);

        addYoutubeUrlToQueue(id);

    } catch (error) {
        console.log(error);
    }
}

// @DEV youtube mixes not implemented yet
async function playYoutubeMix(message, url) {
    const id = url.match(videoIdRegex)[0];
    console.log(id);

    const mixPlaylist = await ytmix(id, { hl: 'en', gl: 'US' });
    console.log(mixPlaylist);
}

function setEmbedAuthor(updateMessage = false) {
    if(pauseEnabled) {
        baseEmbed.setAuthor({name:'Paused'})
    }
    else {
        if(loopEnabled) {
            baseEmbed.setAuthor({name:'Looping'})
        }
        else {
            if(queue.length > 0) {
                baseEmbed.setAuthor({name:`Songs left in Queue: ${queue.length}`});
            }
            else {
                if(autoplayEnabled) {
                    baseEmbed.setAuthor({name:'In Autoplay Mode'});
                }
                else {
                    baseEmbed.setAuthor({name:''});
                }
            }
        }    
    }

    if(updateMessage) {
        if(currentPlayingMessage)
            currentPlayingMessage.edit({ embeds: [baseEmbed] });
    }

}

function updateMoreRow() {
    // disable clear button if queue length is 0
    moreRow.components[clearButtonID].disabled = queue.length === 0;
}

function addSongToDatabase(id, title, author, date) {
    if(!sqlEnabled) return;

    date = hlprFncs.getSQLDate(date);

    mySQLConnection.execute(
        "INSERT INTO `paulbot_db`.`songs` (`idSong`, `nameSong`, `uploaderSong`, firstPlayedSong) values (?, ?, ?, ?)",
        [id, title, author, date],
        function(err, results, fields) {
            if(err)
                console.log("sql error caught", err);
        }
    );
}

function addAutoplayedSongToDatabase(id, originalid, date) {
    if(!sqlEnabled) return;

    date = hlprFncs.getSQLDate(date);

    mySQLConnection.execute(
        "INSERT INTO `paulbot_db`.`songs autoplayed` (`idSong`, `idOriginalSong`, `datePlayed`) values (?, ?, ?)",
        [id, originalid, date],
        function(err, results, fields) {
            if(err)
                console.log("sql error caught", err);
        }
    );
}

function updateSongLastPlayedDatabase(id, date) {
    if(!sqlEnabled) return;

    date = hlprFncs.getSQLDate(date);

    mySQLConnection.execute(
        "UPDATE `paulbot_db`.`songs` SET `lastPlayedSong` = ? WHERE `idSong` = ?",
        [date, id],
        function(err, results, fields) {
            if(err)
                console.log("sql error caught", err);
        }
    );
}

function updateSongTimesPlayedDatabase(id, autoplay = false) {
    if(!sqlEnabled) return;

    const sql = autoplay ? 
        "UPDATE `paulbot_db`.`songs` SET `timesAutoPlayedSong` = timesAutoPlayedSong + 1 WHERE `idSong` = ?" : 
        "UPDATE `paulbot_db`.`songs` SET `timesPlayedSong` = timesPlayedSong + 1 WHERE `idSong` = ?";

    mySQLConnection.execute(
        sql,
        [id],
        function(err, results, fields) {
            if(err)
                console.log("sql error caught", err);
        }
    );
}

function updateSongFavoritedDatabase(id) {
    if(!sqlEnabled) return;

    mySQLConnection.execute(
        "UPDATE `paulbot_db`.`songs` SET `timesFavoritedSong` = timesFavoritedSong + 1 WHERE `idSong` = ?",
        [id],
        function(err, results, fields) {
            if(err)
                console.log("sql error caught", err);
        }
    );
}

//takes url and fetches
async function playSong(song) {
    try {
        console.log("playSong called", song);

        if(currentPlayingMessage) {
            currentPlayingMessage.delete(); //delete current playing message
        } 

        setEmbedAuthor();

        let resource;

        if(song.mode == "ytdl") //youtube
        {
            const stream = await ytdl(song.url, { filter: "audioonly", highWaterMark: 1<<25 });
            const songInfo = await ytdl.getInfo(song.url);

            console.log("play ytdl song", songInfo.videoDetails.title);

            // add song to list of played songs
            addPlayedSong(songInfo.videoDetails.title);

            // update embed
            baseEmbed.setTitle(songInfo.videoDetails.title);
            baseEmbed.setFields({name: "Uploader:", value: songInfo.videoDetails.author.name},
                                {name: "Song Duration:", value: hlprFncs.secondsToMinutes(songInfo.videoDetails.lengthSeconds)}); 

            baseEmbed.setImage(songInfo.videoDetails.thumbnails[songInfo.videoDetails.thumbnails.length - 1].url);
            baseEmbed.setURL(songInfo.videoDetails.video_url);

            currentPlayingMessage = await channel.send({ embeds: [baseEmbed], components: [headerRow] });

            resource = createAudioResource(stream, { inputType: StreamType.Opus });
        }

        if(song.mode == "scdl") //soundcloud
        {
            const stream = await scdl.download(song.url);

            resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

            let songInfo = await scdl.getInfo(song.url);

            baseEmbed.setTitle(songInfo.title);
            baseEmbed.setFields({name: "Artist:", value: songInfo.user.username},
                                {name: "Genre:", value: songInfo.genre},
                                {name: "Song Duration:", value: hlprFncs.millisecondsToMinutes(songInfo.duration)});
            baseEmbed.setImage(songInfo.artwork_url);
            baseEmbed.setURL(songInfo.permalink_url);

            currentPlayingMessage = await channel.send({ embeds: [baseEmbed], components: [headerRow] });
        }        

        try {
            //play the music
            if(resource) {
                player.play(resource);
                connection.subscribe(player);
                currentSong = song;
                playSongAttempts = 0;
                
                return true;
            }
            else { //try again if failed for whatever reason
                setTimeout(playSong, 500, song);
                return false;
            }
        } catch (error) {
            if(playSongAttempts < 5)
            {
                console.log("error caught while attempting to play song again", error);
                playSongAttempts ++;
                setTimeout(playSong, 500, song);
            }
            else {
                console.log("ran out of autoplay attempts", error);
                playSongAttempts = 0;
                return false;
            }
        }
    } catch (error) {
        console.log(error);
        return false;
    }
}

function addPlayedSong(title) {
    title = titleClear(title);

    if(playedSongs.includes(title))
        return;

    if(playedSongs.length > playedSongsLength) {
        playedSongs.pop();
    }

    playedSongs.unshift(title);

    return true;
}

//returns true if the song has likely been played already
function checkForPlayedSong(name) {
    try {
        name = titleClear(name);

        for (let i = 0; i < playedSongs.length; i++) {
            const element = playedSongs[i];

            const _regExp1 = new RegExp(`(${element})`, 'g');
            const _regExp2 = new RegExp(`(${name})`, 'g');
    
            if(name === element)
                return true;

            if(_regExp1.test(name))
                return true;
            if(_regExp2.test(element))
                return true;
    
            let value = strsimilarity.compareTwoStrings(name, element);
            if(value > autoplaySimilarityThreshold) 
                return true;
        }
    } catch (error) {
        console.log(error);
    }

    return false;
}

async function pause(sendMessage = false) {
    if(playerStatus == AudioPlayerStatus.Playing) {
        pauseEnabled = true;
        headerRow.components[playButtonID].setLabel("Play");
        headerRow.components[playButtonID].setStyle("SUCCESS");

        player.pause();

        if (sendMessage)
            channel.send(`${client.user.username}` + ' is paused');
    }
}

async function resume(sendMessage = false) {
    if(playerStatus == AudioPlayerStatus.Paused) {
        pauseEnabled = false;
        headerRow.components[playButtonID].setLabel('Pause');
        headerRow.components[playButtonID].setStyle("SECONDARY");

        player.unpause();
        if (sendMessage)
            channel.send(`${client.user.username}` + ' is resumed');
    }
}

async function loop(sendMessage = false) {
    if(loopEnabled == false) {
        moreRow.components[loopButtonID].setLabel("End Loop");
        moreRow.components[loopButtonID].setStyle("SUCCESS");
        loopEnabled = true;

        return;
    }

    if(loopEnabled == true) {
        moreRow.components[loopButtonID].setLabel("Start Loop");
        moreRow.components[loopButtonID].setStyle("SECONDARY");
        loopEnabled = false;

        return;
    }
}

async function clear(sendMessage = false) {
    if(queue.length > 0) {
        queue.length = 0;
        //row.components[clearButtonID].setDisabled(true);
        if (sendMessage)
            channel.send('Queue Cleared :(');
    }
}

async function skip() {
    if(queue.length == 0) {
        if(autoplayEnabled) {
            await resume();

            if(!autoplaySongs[0])
            {
                await autoplaySelector(currentSong);
            }
            
            if(autoplaySongs[0]) {
                playSong(autoplaySongs[0]);
                autoplaySongs.shift(); 
            }
        }

        return;
    }
    else
    {
        await resume();
        let _song = queue[0];
        queue.shift();
        await playSong(_song);

        return;
    }
}

async function autoplay() {
    if(autoplayEnabled == false) {
        headerRow.components[autoplayButtonID].setLabel("Disable Autoplay");
        headerRow.components[autoplayButtonID].setStyle("SUCCESS");
        autoplayEnabled = true;

        return;
    }

    if(autoplayEnabled == true) {
        headerRow.components[autoplayButtonID].setLabel("Enable Autoplay");
        headerRow.components[autoplayButtonID].setStyle("SECONDARY");
        autoplayEnabled = false;

        return;
    }
}

//EVENT METHODS

player.on(AudioPlayerStatus.Playing, () => {
	console.log('The audio player has started playing!');
    playerStatus = AudioPlayerStatus.Playing;
});

player.on(AudioPlayerStatus.Paused, () => {
    console.log('The audio player has paused');
    playerStatus = AudioPlayerStatus.Paused;
});

player.on("error", (error) => {
    console.log(error);
});

client.on("error", (error) => {
    console.log(error);
});

player.on(AudioPlayerStatus.Idle, () => {
    if(loopEnabled == true) {
        try {
            setTimeout(playSong, 500, currentSong);
        } catch (error) {
            console.log(error)
        }
        
        return;
    }

    if(queue.length == 0) { //if theres no songs left in queue
        //if we have autoplay
        if(autoplayEnabled) {
            skip();
        }
        else {
            console.log("idling state");
            playerStatus = AudioPlayerStatus.Idle;
        }

        return;
    }
    else //if there are, play the next one
    {
        playSong(queue[0]);
        queue.shift(); 

        return;
    }
});

//button interactions events
client.on('interactionCreate', async interaction => {
	if (!interaction.isButton()) return;

    if(interaction.customId == "play") { //if play/pause interaction invoked
        if(playerStatus == AudioPlayerStatus.Paused) {
            resume();
        }
        else {
            pause();
        }
    }

    if(interaction.customId == "skip") { //if skip interaction invoked
        skip();
        return;
    }
    
    if(interaction.customId == "autoplay") { //if autoplay
        autoplay();
    }

    if(interaction.customId == "favorite") { //if song is favorited
        if(sqlEnabled) {
            updateSongFavoritedDatabase(currentSong.url);
        }
        await interaction.user.send({ embeds: [baseEmbed] });
        await interaction.reply({ content: 'finna slide in those DMs', ephemeral: true});
        return;
    }

    if(interaction.customId == "more") {
        // await interaction.reply({ components: [moreRow], ephemeral: true });
        updateMoreRow();
        await interaction.update({ components: [moreRow] });
        return;
    }

    if(interaction.customId == "loop") { //if loop interaction invoked
        updateMoreRow();
        loop();
        setEmbedAuthor();
        interaction.update({ embeds: [baseEmbed], components: [moreRow] });
        return;
    }

    if(interaction.customId == "clear") { //if clear
        updateMoreRow();
        // check for permissions to clear queue
        if(interaction.member.roles.cache.find(r => r.name === "DJ")) {
            clear(true);
            await interaction.reply({ content: `Queue cleared by ${interaction.member.displayName}`});
        }
        else {
            await interaction.reply({ content: 'You do not have the right role to clear the queue.', ephemeral: true});
        }
        return;
    }

    if(interaction.customId == "less") {
        await interaction.update({ components: [headerRow] });
        return;
    }

    setEmbedAuthor();
    // update our buttons to reflect changes
    await interaction.update({ embeds: [baseEmbed], components: [headerRow] });
});

client.login(token);