const youtubedl = require('youtube-dl-exec');

async function test() {
    try {
        console.log("Fetching Autoplay via yt-dlp Mix...");
        const videoId = '1t-gK-9EIq4'; // Starboy
        const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
        
        const info = await youtubedl(mixUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            playlistItems: '2' // Get the second track in the auto-mix loop
        });

        const entry = info.entries ? info.entries[0] : info;
        console.log("Up Next ID:", entry?.id);
        console.log("Up Next Title:", entry?.title);
        
        process.exit(0);
    } catch(e) {
        console.error(e.message);
        process.exit();
    }
}
test();
