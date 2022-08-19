class HelperFunctions {

    static symbolRegex = new RegExp(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/, 'g');

    //https://stackoverflow.com/a/3733257
    secondsToMinutes(timeInSeconds) {
        timeInSeconds = Number(timeInSeconds);
        let hours = (Math.floor(timeInSeconds / 3600)).toFixed(0);
        timeInSeconds = timeInSeconds - hours * 3600;

        let minutes = ((timeInSeconds / 60) - 1).toFixed(0);
        let seconds = ((timeInSeconds % 60)).toFixed(0);

        if(hours.length === 1) {
            hours = "0" + hours;
        }

        if(minutes.length === 1) {
            minutes = "0" + minutes;
        }

        if(seconds.length === 1) {
            seconds = "0" + seconds;
        }

        if(hours === "00")
            return String(minutes + ":" + seconds);
        else
            return String(hours + ":" + minutes + ":" + seconds);
        //return String(timeInSeconds / 60).charAt(0) + ":" + seconds;
    }
    
    millisecondsToMinutes(timeInMilliseconds) {
        const timeInSeconds = Number(timeInMilliseconds) / 1000; //convert to seconds
        return this.secondsToMinutes(timeInSeconds);
        // return String(timeInMilliseconds / 60).charAt(0) + ":" + (timeInMilliseconds % 60);
    }
    
    //https://stackoverflow.com/a/44831930 for date conversion
    getSQLDate(date) {
        return date.toISOString().slice(0, 19).replace('T', ' ');
    }

    //https://stackoverflow.com/a/43467144
    isValidHttpUrl(string) {
        let url;
        
        try {
            url = new URL(string);
        } catch (_) {
            return false;  
        }
        
        return url.protocol === "http:" || url.protocol === "https:";
    }

    getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    clearSymbols(string) {
        return string.replace(HelperFunctions.symbolRegex, '');
    }

    compareQueryResult(query, result) {

        try {
            result = this.clearSymbols(result.toLowerCase());
            const querySplit = this.clearSymbols(query.toLowerCase()).split(" ");
            const resultSplit = this.clearSymbols(result.toLowerCase()).split(" ");
    
            // console.log(resultSplit);
    
            const queryLength = querySplit.length;
            const resultLength = resultSplit.length;

            let score = 0.0;
    
            for (let i = 0; i < queryLength; i++) {

                const element = querySplit[i];
                const _regExp1 = new RegExp(`(${element})`, 'g');


                if(_regExp1.test(result)) {
                    score += ( 1 / queryLength ) * 2;
                }
            }
    
            for (let i = 0; i < resultLength; i++) {

                const element2 = resultSplit[i];

                if(element2 == "")
                    continue;

                const _regExp2 = new RegExp(`(${element2})`, 'g');
    
                if(!_regExp2.test(query)) {
                    score -= ( 1 / resultLength );
                }
            }
    
            return score;
        } catch (error) {
            console.log(error);
            return -1;
        }

    }
}

module.exports = new HelperFunctions();