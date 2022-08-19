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

const connections = new Map();

const autoplayMaxLength = 50; //length of autoplay playlist
const maxAutoplaySongLength = 600; //max length of a song before we skip it (so we don't get hour long loops, etc)

let autoplaySimilarityThreshold = 0.75;
let autoplayOriginalSong; //stores the song our autoplay is based off of
const autoplayWordBlacklist = ["live", "performance", "gma", "show", "perform", "late", "react", "award", "gameplay", "saber", "album", "hour", "ceremony", "fmv", "cinematic", "new", "mv"]; //stores words that should be skipped by autoplay
const symbolRegex = new RegExp(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/, 'g');
const parenthesisRegex = new RegExp(/\(([^()]+)\)/, 'g');
const bracketRegex = new RegExp(/\[([^\[\]]+)\]/, 'g');
const videoIdRegex = new RegExp(/(?<=v=\s*).*?(?=\s*&)/, 'g');
const titleRegexList = ["music", "lyric", "video", "official"];

const playedSongsLength = 50; //max length of played songs before we stop storing (don't want to store too many for memory sake)

const autoplayButtonID = 2;
const playButtonID = 0;
const loopButtonID = 0;
const clearButtonID = 1;

let playSongAttempts = 0;

let maxytmixIndex = 50;

const embedColor = '#ffffff'; //used to change color of the embed
const baseEmbed = new MessageEmbed().setColor(embedColor); //the embed we change for every new song

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

    if(content.startsWith(`${prefix}join`)) //join command
    {
        if(message.member.voice.channel) //if in channel
        {
            join(message.member.voice.channel, message);
        }
        return;
    }

    if(content.startsWith(`${prefix}leave`)) //leave command
    {
        leave(message.guild.id);
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
        const connection = connections.get(message.guild.id);
        // join the channel if we are not in it already
        if(message.member.voice.channel !== connection?.voiceChannel || !connection?.voiceChannel)
        {
            console.log(" joining you dawg ");
            join(message.member.voice.channel, message);
        }

        play(message);
        return;
    }
});

async function join(voiceChannel, message) {
    const _connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const guildConnection = {
        connection: _connection,
        player: createAudioPlayer(),
        message: null,
        features: {
            loopEnabled: false,
            autoplayEnabled: false,
        },
        textChannel: message.channel,
        voiceChannel: voiceChannel,
        currentSong: null,
        queue: [],
        autoplayQueue: [],
        playedSongs: [],
        playerStatus: AudioPlayerStatus.Idle,
        embed: new MessageEmbed().setColor(embedColor).setThumbnail(voiceChannel.guild.iconURL()),
        rowOne: new MessageActionRow().addComponents([
            new MessageButton()
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
        ]),
        rowTwo: new MessageActionRow().addComponents([
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
        ])
    };

    connections.set(voiceChannel.guild.id, guildConnection);
    subscribeToPlayerEvents(voiceChannel.guild.id);
}

async function leave(guildId) {
    const connection = connections.get(guildId);
    if(typeof connection?.connection !== 'undefined') //if connection exists
    {
        connection.playerStatus = AudioPlayerStatus.Idle;
        connection.connection.destroy();
        connections.delete(guildId); // might be too extreme?
    }
}

async function autoplaySelector(guildId, song, mode="youtube-mix") {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(!connection.features.autoplayEnabled)
        return;

    if(connection.autoplayQueue.length >= autoplayMaxLength)
        connection.autoplayQueue.shift();

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
                const result = await addAutoplaySong(guildId, _track);

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
        const mixPlaylist = await ytmix(song.url, { hl: 'en', gl: 'US' });

        if(mixPlaylist) {
            for (let i = 0; i < mixPlaylist.items.length; i++) {
                const element = mixPlaylist.items[i];
            
                const title = titleClear(element.title.toLowerCase());
        
                // if(autoplayCheckBlacklist(title, "")) //skips over if word is on blacklist
                //     continue;
        
                if(checkForPlayedSong(guildId, title))
                    continue;
    
                // check again if the list is too long
                if (connection.autoplayQueue.length >= autoplayMaxLength)
                    connection.autoplayQueue.shift();

                // adds song to autoplay list
                connection.autoplayQueue.push({
                    url: element.id, 
                    mode: "ytdl",
                    name: title,
                    artist: "",
                });

                if(sqlEnabled)
                {
                    const _date = new Date();
    
                    // // first add the song to `songs` table if its not there already
                    // addSongToDatabase(element.id, element.title, element.author.name, _date);
                    // // then add the song to `songs autoplayed` table
                    // // addAutoplayedSongToDatabase(element.id, element.url, _date);
                    // // then update last played 
                    // updateSongLastPlayedDatabase(element.id, _date);
                    // // then update times played
                    // updateSongTimesPlayedDatabase(element, true);
                }
            }
            return;
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

            if(checkForPlayedSong(guildId, title)) {
                console.log("has song been played already");
                continue;
            }

            // check again if the list is too long
            if (connection.autoplayQueue.length >= autoplayMaxLength)
                connection.autoplayQueue.shift();

            // adds song to autoplay list
            connection.autoplayQueue.push({
                url: element.id, 
                mode: "ytdl",
                name: title,
                artist: "",
            });

            break;
        }
    }

}

async function addAutoplaySong(guildId, _track) {
    const connection = connections.get(guildId);
    if(!connection) return;

    const title = _track.name;
    const author = _track.artist.name;
    
    if(checkForPlayedSong(guildId, title)) {
        console.log("has song been played already");
        return false;
    }

    console.log("title of autoplay song: ", title);  

    if (connection.autoplayQueue.length >= autoplayMaxLength)
        connection.autoplayQueue.shift();

    const trackInfo = await youtubesr.searchOne(`${author} ${title}`);

    if(trackInfo) {
        connection.autoplayQueue.push({
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

    // @TODO add some sort of feedback to user
    // currentSearchingMessage = await message.channel.send(`${client.user.username}` + ' is searching for your request...');

    let songInfo;
    let isURL = false;

    // handle links
    //check if url or not
    if(hlprFncs.isValidHttpUrl(searchQuery)) {
        isURL = true;
        //#region soundcloud links
        if(searchQuery.includes('soundcloud.com')) //could be better way of checking if it is soundcloud
        {
            try {
                songInfo = await scdl.getInfo(searchQuery);

                if(songInfo) {
                    // if (currentSearchingMessage) {
                    //     currentSearchingMessage.delete(); //replace our search message
                    // }
                    
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
        isURL = false;
        console.log("invalid url, searching for query");
    }

    try {
        // if it is url we use more reliable ytdl for info
        // if not we search youtube for the query
        let results;

        if(isURL)
        {
            const ytdlQuery = await ytdl.getInfo(searchQuery);
            results = {
                id: ytdlQuery.videoDetails.videoId,
                title: ytdlQuery.videoDetails.title,
                channel: {
                    name: ytdlQuery.videoDetails.ownerChannelName
                }
            };
        }
        else 
            results = await youtubesr.searchOne(searchQuery);

        songInfo = results;
    } catch (error) {
        console.log(console.log("error searching youtube for song"), error);
    }

    try {
        if(songInfo) {
            // dataSheet.AddRow(songInfo.id, songInfo.title, songInfo.channel.name, new Date().toLocaleDateString(), message.author.username, message.author.id);
            if(sqlEnabled) {
                //@TODO add guild tracking here
                const _date = new Date();
                // store song that played
                addSongToDatabase(songInfo.id, songInfo.title, songInfo.channel?.name, _date);
                // update last time this song has been played
                updateSongLastPlayedDatabase(songInfo.id, _date);
                updateSongTimesPlayedDatabase(songInfo.id);

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

            // delete search message to lower channel bloat
            // if (currentSearchingMessage) {
            //     currentSearchingMessage.delete();
            // }

            const connection = connections.get(message.guild.id);

            if(connection) {
                // reset autoplay queue
                connection.autoplayQueue.length = 0;
                connection.queue.push
                ({
                    url: songInfo.id,
                    mode: "ytdl",
                    name: titleClear(songInfo.title),
                    artist: "",
                });

                if(connection.playerStatus === AudioPlayerStatus.Idle){
                    skip(message.guild.id);
                }
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
            const connection = connections.get(message.guild.id);

            if(connection) {
                connection.queue.push
                ({
                    url: songInfo.id,
                    mode: "ytdl",
                    name: titleClear(songInfo.title),
                    artist: "",
                });
    
                if(connection.playerStatus === AudioPlayerStatus.Idle){
                    skip(message.guild.id);
                }
            }
        }
        
    } catch (error) {
        console.log(error);
    }
}

async function playYoutubePlaylist(message, url)
{
    try {
        const isValid =  await ytpl.validateID(url);

        if(isValid) {
            const playlistInfo = await ytpl(url);

            if(playlistInfo) {
                
                const connection = connections.get(message.guild.id);

                if(connection) {

                    for (let i = 0; i < playlistInfo.items.length; i++) {
                        const element = playlistInfo.items[i];
    
                        connection.queue.push
                        ({
                            url: songInfo.id,
                            mode: "ytdl",
                            name: titleClear(songInfo.title),
                            artist: "",
                        });
                    }
        
                    if(connection.playerStatus === AudioPlayerStatus.Idle){
                        skip(message.guild.id);
                    }

                    setEmbedAuthor(message.guild.id, true);
                }

                message.channel.send(`${client.user.username}` + " has added " + "**" + `${playlistInfo.items.length}` + "**" + " songs");
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

function setEmbedAuthor(guildId, updateMessage = false) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.playerStatus === AudioPlayerStatus.Paused) {
        connection.embed.setAuthor({name:'Paused'});
    }
    else {
        if(connection.features.loopEnabled) {
            connection.embed.setAuthor({name:'Looping'});
        }
        else {
            if(connection.queue.length > 0) {
                connection.embed.setAuthor({name:`Songs left in Queue: ${connection.queue.length}`});
            }
            else {
                if(connection.features.autoplayEnabled) {
                    connection.embed.setAuthor({name:'In Autoplay Mode'});
                }
                else {
                    connection.embed.setAuthor({name:''});
                }
            }
        }    
    }

    if(updateMessage) {
        if(connection.message)
            connection.message.edit({ embeds: [baseEmbed] });
    }
}

function updateMoreRow(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;
    // disable clear button if queue length is 0
    connection.rowTwo.components[clearButtonID].disabled = connection.queue.length === 0;
}

// sql functions

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
async function playSong(guildId, song) {
    try {
        const connection = connections.get(guildId);
        if(!connection) return;

        if(connection.message) {
            connection.message.delete(); //delete current playing message
        } 

        setEmbedAuthor();

        let resource;

        if(song.mode == "ytdl") //youtube
        {
            const stream = await ytdl(song.url, { filter: "audioonly", highWaterMark: 1<<25 });
            const songInfo = await ytdl.getInfo(song.url);

            connection.currentSong = song;

            console.log("play ytdl song", songInfo.videoDetails.title);

            // add song to list of played songs
            addPlayedSong(guildId, songInfo.videoDetails.title);

            // update embed
            // @TODO move this to function
            connection.embed.setTitle(songInfo.videoDetails.title);
            connection.embed.setFields({name: "Uploader:", value: songInfo.videoDetails.author.name},
                                {name: "Song Duration:", value: hlprFncs.secondsToMinutes(songInfo.videoDetails.lengthSeconds)}); 

            connection.embed.setImage(songInfo.videoDetails.thumbnails[songInfo.videoDetails.thumbnails.length - 1].url);
            connection.embed.setURL(songInfo.videoDetails.video_url);

            resource = createAudioResource(stream, { inputType: StreamType.Opus });
        }

        if(song.mode == "scdl") //soundcloud
        {
            const stream = await scdl.download(song.url);

            resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

            const songInfo = await scdl.getInfo(song.url);

            console.log("play scdl song", songInfo.title);

            connection.embed.setTitle(songInfo.title);
            connection.embed.setFields({name: "Artist:", value: songInfo.user.username},
                                {name: "Genre:", value: songInfo.genre},
                                {name: "Song Duration:", value: hlprFncs.millisecondsToMinutes(songInfo.duration)});
            connection.embed.setImage(songInfo.artwork_url);
            connection.embed.setURL(songInfo.permalink_url);
        }        

        connection.message = await connection.textChannel.send({ embeds: [connection.embed], components: [connection.rowOne] });

        try {
            //play the music
            if(resource) {
                connection.player.play(resource);
                connection.connection.subscribe(connection.player);
                playSongAttempts = 0; //@TODO move this
                
                return true;
            }
            else { //try again if failed for whatever reason
                setTimeout(playSong, 500, guildId, song);
                return false;
            }
        } catch (error) {
            if(playSongAttempts < 5)
            {
                console.log("error caught while attempting to play song again", error);
                playSongAttempts ++;
                setTimeout(playSong, 500, guildId, song);
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

function addPlayedSong(guildId, title) {
    const connection = connections.get(guildId);
    if(!connection) return;

    const playedSongs = connection.playedSongs;
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
function checkForPlayedSong(guildId, name) {
    try {
        const connection = connections.get(guildId);
        if(!connection) return;

        const playedSongs = connection.playedSongs;

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

async function pause(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.playerStatus === AudioPlayerStatus.Playing) {
        connection.rowOne.components[playButtonID].setLabel("Play");
        connection.rowOne.components[playButtonID].setStyle("SUCCESS");

        connection.player.pause();
    }
}

async function resume(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.playerStatus === AudioPlayerStatus.Paused) {
        connection.rowOne.components[playButtonID].setLabel('Pause');
        connection.rowOne.components[playButtonID].setStyle("SECONDARY");

        connection.player.unpause();
    }
}

async function loop(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.features.loopEnabled === false) {
        connection.rowTwo.components[loopButtonID].setLabel("End Loop");
        connection.rowTwo.components[loopButtonID].setStyle("SUCCESS");
        connection.features.loopEnabled = true;

        return;
    }

    if(connection.features.loopEnabled === true) {
        connection.rowTwo.components[loopButtonID].setLabel("Start Loop");
        connection.rowTwo.components[loopButtonID].setStyle("SECONDARY");
        connection.features.loopEnabled = false;

        return;
    }
}

async function clear(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.queue.length > 0) {
        connection.queue.length = 0;
    }
}

async function skip(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.queue.length === 0) {
        if(connection.features.autoplayEnabled) {
            await resume(guildId);
            if(connection.autoplayQueue.length <= 1)
                await autoplaySelector(guildId, connection.currentSong);

            console.log("queue", connection.autoplayQueue);
            const _song = connection.autoplayQueue.shift();
            await playSong(guildId, _song);
        }

        return;
    }
    else
    {
        await resume(guildId);
        const _song = connection.queue.shift();
        await playSong(guildId, _song);

        return;
    }
}

async function autoplay(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    if(connection.features.autoplayEnabled === false) {
        connection.rowOne.components[autoplayButtonID].setLabel("Disable Autoplay");
        connection.rowOne.components[autoplayButtonID].setStyle("SUCCESS");
        connection.features.autoplayEnabled = true;

        return;
    }

    if(connection.features.autoplayEnabled === true) {
        connection.rowOne.components[autoplayButtonID].setLabel("Enable Autoplay");
        connection.rowOne.components[autoplayButtonID].setStyle("SECONDARY");
        connection.features.autoplayEnabled = false;

        return;
    }
}

async function surpriseMe() {
    if(!sqlEnabled) return;

    const todayDate = hlprFncs.getSQLDate(new Date());

    mySQLConnection.execute(
        "INSERT INTO `paulbot_db`.`songs` (`idSong`, `nameSong`, `uploaderSong`, firstPlayedSong) values (?, ?, ?, ?)",
        [id, title, author, date],
        function(err, results, fields) {
            if(err)
                console.log("sql error caught", err);
        }
    );
}

function subscribeToPlayerEvents(guildId) {
    const connection = connections.get(guildId);
    if(!connection) return;

    const player = connection.player;

    console.log("player found", player);

    player.on(AudioPlayerStatus.Playing, () => {
        console.log('The audio player has started playing!');
        connection.playerStatus = AudioPlayerStatus.Playing;
    });
    
    player.on(AudioPlayerStatus.Paused, () => {
        console.log('The audio player has paused');
        connection.playerStatus = AudioPlayerStatus.Paused;
    });
    
    player.on("error", (error) => {
        console.log(error);
    });
    
    player.on(AudioPlayerStatus.Idle, () => {
        if(connection.features.loopEnabled === true) {
            try {
                setTimeout(playSong, 500, guildId, currentSong);
            } catch (error) {
                console.log(error)
            }
            
            return;
        }
    
        if(connection.queue.length === 0) { //if theres no songs left in queue
            //if we have autoplay
            if(connection.features.autoplayEnabled) {
                skip(guildId);
            }
            else {
                console.log("idling state");
                connection.playerStatus = AudioPlayerStatus.Idle;
            }
    
            return;
        }
        else //if there are, play the next one
        {
            playSong(guildId, connection.queue[0]);
            connection.queue.shift(); 
    
            return;
        }
    });
}

//EVENT METHODS

client.on("error", (error) => {
    console.log(error);
});

//button interactions events
client.on('interactionCreate', async interaction => {
	if (!interaction.isButton()) return;

    const guildId = interaction.guild.id;

    const connection = connections.get(guildId);
    if(!connection) return;

    if(interaction.customId == "play") { //if play/pause interaction invoked
        if(connection.playerStatus === AudioPlayerStatus.Paused) {
            resume(guildId);
        }
        else {
            pause(guildId);
        }
    }

    if(interaction.customId == "skip") { //if skip interaction invoked
        skip(guildId);
        return;
    }
    
    if(interaction.customId == "autoplay") { //if autoplay
        autoplay(guildId);
    }

    if(interaction.customId == "favorite") { //if song is favorited
        if(sqlEnabled) {
            updateSongFavoritedDatabase(connection.currentSong.url);
        }
        await interaction.user.send({ embeds: [connection.embed] });
        await interaction.reply({ content: 'finna slide in those DMs', ephemeral: true});
        return;
    }

    if(interaction.customId == "more") {
        updateMoreRow(guildId);
        await interaction.update({ components: [connection.rowTwo] });
        return;
    }

    if(interaction.customId == "loop") { //if loop interaction invoked
        updateMoreRow(guildId);
        loop(guildId);
        setEmbedAuthor(guildId);
        interaction.update({ embeds: [connection.embed], components: [connection.rowTwo] });
        return;
    }

    if(interaction.customId == "clear") { //if clear
        updateMoreRow(guildId);
        // check for permissions to clear queue
        if(interaction.member.roles.cache.find(r => r.name === "DJ")) {
            clear(guildId);
            await interaction.reply({ content: `Queue cleared by ${interaction.member.displayName}`});
        }
        else {
            await interaction.reply({ content: 'You do not have the right role to clear the queue.', ephemeral: true});
        }
        return;
    }

    if(interaction.customId == "less") {
        await interaction.update({ components: [connection.rowOne] });
        return;
    }

    setEmbedAuthor(guildId);
    // update our buttons to reflect changes
    await interaction.update({ embeds: [connection.embed], components: [connection.rowOne] });
});

client.login(token);