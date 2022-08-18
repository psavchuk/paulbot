# Paulbot
Another discord bot for playing music

![image](https://user-images.githubusercontent.com/38636939/185458538-fb30bbfe-b7dd-48f2-8a4e-ee1ddc6b62e3.png)

## Features
- Youtube and Soundcloud playback
- Music autoplay, for when you don't feel like adding songs all the time
- Interactive user experience using Discord API
- Optional link to an SQL database to track played songs (to be used for some features)
- Favorite songs that strike your fancy

## Set Up
- Install NodeJS
- Clone the repository (Github Desktop, git, or download)
- Run `npm install` in the folder where you cloned the repository (using terminal of your choice)
- Create a `secret.json` file in the directory, and include your Discord token
  `{
    token: "Your Discord Token goes here" 
  }`
- More information on setting up a Discord bot can be found [here](https://discord.com/developers/docs/getting-started)
- Run `npm start` in the folder where you cloned the repository to start the bot!

## Using the Bot
- Default prefix for running commands is `<3`, config is located in the config.json folder
- Example command to play a song `<3play https://www.youtube.com/watch?v=DmNfT-B7nlA`
- All commands are `play`, `join`, `leave`, `pause`, `resume`, `skip`, `clear`

## Plans
- 'Surprise Me' button to pick songs from database
- Request history of played songs
- Website / dashboard for above feature
- Change color themes
