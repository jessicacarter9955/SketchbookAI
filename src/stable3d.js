
async function GenerateGLBFromPrompt(prompt) {
    const imageBlob = await GenerateImage(prompt);
    return GenerateGLB(imageBlob);
}
async function GenerateImage(input) {
    let HfInference = (await import('https://esm.sh/@huggingface/inference')).HfInference;
    const prompt = input + ',Full-shot ,Full-length ,entire 3d model, object only, realism, Uncropped, stand alone, white background';
    const hf = new HfInference(process.env.HUGGINGFACE_TOKEN || 'YOUR_HUGGINGFACE_TOKEN_HERE');

    const generatedImageBlob = await hf.textToImage({
        model: 'black-forest-labs/FLUX.1-schnell',
        inputs: prompt
    });
    return generatedImageBlob;

}

async function GenerateGLB(origImgBlob) {

    // Create an image element
    const img = new Image();
    img.src = URL.createObjectURL(origImgBlob);

    // Wait for the image to load
    await new Promise((resolve) => {
        img.onload = resolve;
    });

    // Create a canvas and resize the image while keeping aspect ratio
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 1024;

    // Calculate the aspect ratio and fit the image exactly to 1024x1024
    const aspectRatio = img.width / img.height;
    let drawWidth, drawHeight, offsetX, offsetY;

    if (aspectRatio > 1) {
        drawWidth = 1024;
        drawHeight = 1024 / aspectRatio;
        offsetX = 0;
        offsetY = (1024 - drawHeight) / 2;
    } else {
        drawWidth = 1024 * aspectRatio;
        drawHeight = 1024;
        offsetX = (1024 - drawWidth) / 2;
        offsetY = 0;
    }

    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);


    // Convert the canvas to a blob in JPG format
    const imageBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg');
    });

    let hash = Math.random().toString(36).substring(2, 11) ;

    const formData = new FormData();
    formData.append('files', imageBlob, imageBlob.name);

    let filePaths = await fetch("https://stabilityai-stable-fast-3d.hf.space/upload?upload_id=" + hash, {
        method: "POST",
        body: formData,
        headers: {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Google Chrome\";v=\"127\", \"Chromium\";v=\"127\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin"
        },
        referrer: "https://stabilityai-stable-fast-3d.hf.space/?__theme=light",
        referrerPolicy: "strict-origin-when-cross-origin",
        mode: "cors",
        credentials: "include"
    }).then(a => a.json());



    await fetch("https://stabilityai-stable-fast-3d.hf.space/queue/join?__theme=light", {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/json",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Google Chrome\";v=\"127\", \"Chromium\";v=\"127\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin"
        },
        "referrer": "https://stabilityai-stable-fast-3d.hf.space/?__theme=light",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": JSON.stringify({
            data: [
                "Remove Background",
                {
                    path: filePaths[0],
                    url: "https://stabilityai-stable-fast-3d.hf.space/file=" + filePaths[0],
                    orig_name: filePaths[0].split("/").pop(),
                    size: formData.get('files').size,
                    mime_type: "image/png",
                    meta: {
                        _type: "gradio.FileData"
                    }
                },
                null,
                0.85
            ],
            event_data: null,
            fn_index: 5,
            trigger_id: 10,
            session_hash: hash
        }),
        "method": "POST",
        "mode": "cors",
        "credentials": "include"
    }).then(a => a.json());

    const response = await fetch("https://stabilityai-stable-fast-3d.hf.space/queue/data?session_hash=" + hash, {
        headers: {
            "accept": "text/event-stream",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Google Chrome\";v=\"127\", \"Chromium\";v=\"127\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin"
        }
    }).then(a => a.text());
    console.log(response);


    fetch("https://stabilityai-stable-fast-3d.hf.space/queue/join?__theme=light", {
        "headers": {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/json",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Google Chrome\";v=\"127\", \"Chromium\";v=\"127\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin"
        },
        "referrer": "https://stabilityai-stable-fast-3d.hf.space/?__theme=light",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": JSON.stringify({
            data: [
                "Run",
                {
                    path: filePaths[0],
                    url: "https://stabilityai-stable-fast-3d.hf.space/file=" + filePaths[0],
                    orig_name: filePaths[0].split("/").pop(),
                    size: formData.get('files').size,
                    mime_type: "image/png",
                    meta: { _type: "gradio.FileData" }
                },
                null,
                0.85
            ],
            event_data: null,
            fn_index: 5,
            trigger_id: 10,
            session_hash: hash
        }),
        "method": "POST",
        "mode": "cors",
        "credentials": "include"
    }).then(a => a.text());



    const response2 = await fetch("https://stabilityai-stable-fast-3d.hf.space/queue/data?session_hash=" + hash, {
        headers: {
            "accept": "text/event-stream",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Google Chrome\";v=\"127\", \"Chromium\";v=\"127\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin"
        }
    }).then(a => a.text());
    const glbUrl = response2.match(/\"url\":\"(.*?\.glb)\"/)?.[1];
    if (glbUrl) {
        console.log('Extracted GLB URL:', glbUrl);
        return glbUrl;
    } else {
        console.error('Failed to extract GLB URL');
    }
    console.log(response2);
}

