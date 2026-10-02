import('https://esm.sh/@huggingface/inference').then(({ HfInference }) => globalThis.HfInference = HfInference);

globalThis.siteUrl = (globalThis.isLocal && false ? "http://localhost:3000/" : "https://api.gptcall.net/");
globalThis.getChatGPTResponse = async function* ({messages,functions,model="grok-code",signal,apiUrl=siteUrl,apiKey=settings.apiKey}) {

    messages = messages.map(message => ({
        role: message.role,
        content: message.content,
        name: message.name,
        function_call: message.function_call
    }));
    let body = {
        model: model, 
        messages:messages,
        functions: functions,
        stream: true,
        
        max_tokens:200000/2
     }

    // Show API request as XML if toggle is enabled
    if (settings.showAPIRequestXML) {
        openAPIRequestAsXML(body);
    }

    if (apiKey == "kg") apiKey = "kg" + generateHash(JSON.stringify(body));

    if (apiKey.startsWith("hf_")) {
        const hf = new HfInference(apiKey);
        const ep = hf.endpoint(apiUrl);
        const stream = await ep.chatCompletionStream(body, { signal });
        let combined = {};
        for await (const chunk of stream) {
            if (chunk.choices && chunk.choices.length > 0) {
                combined.message = combineJSON(combined.message, chunk.choices[0].delta);
                combined = { ...combined, ...chunk.choices[0] };
                yield combined;
            }
        }
    }
    else {
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        };

        const response = await fetch(apiUrl+"/chat/completions", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
            signal: signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let combined = { message: {} };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value);
            const parts = buffer.split("\n");
            buffer = parts.pop();

            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    if (part.substring(6) === "[DONE]") {
                        return combined;
                    }
                    let json = JSON.parse(part.substring(6));
                    let responseObj = json.choices?.[0];
                    if (json.error?.code) {
                        throw new Error(json.error.message);
                    }
                    if (!responseObj) continue;
                    combined.message = combineJSON(combined.message, responseObj.delta);
                    combined = { ...combined, ...responseObj };
                    yield combined;
                }
            }
        }
    }
}


function combineJSON(obj1, obj2) {
    var combinedObj = {};

    for (var key in obj1) {
        if (obj1.hasOwnProperty(key) && obj2.hasOwnProperty(key) && obj1[key] !== obj2[key]) {
            if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
                combinedObj[key] = combineJSON(obj1[key], obj2[key]);
            } else {
                combinedObj[key] = obj1[key] + obj2[key];
            }
        } else {
            combinedObj[key] = obj1[key];
        }
    }

    for (var key in obj2) {
        if (!combinedObj.hasOwnProperty(key)) {
            combinedObj[key] = obj2[key];
        }
    }

    return combinedObj;
}

function generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
    }
    return Math.abs(hash); // Ensure the hash is positive
}

function openAPIRequestAsXML(body) {
    // Convert JSON body to XML format
    const xml = jsonToXML(body);
    
    // Create a blob with XML content
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    
    // Open in new tab
    window.open(url, '_blank');
    
    // Clean up the URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function jsonToXML(obj, rootName = 'api_request') {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    
    function convertValue(value, key, indent = '') {
        if (value === null || value === undefined) {
            return `${indent}<${key} />\n`;
        }
        
        if (Array.isArray(value)) {
            let result = `${indent}<${key}>\n`;
            value.forEach((item, index) => {
                result += convertValue(item, 'item', indent + '  ');
            });
            result += `${indent}</${key}>\n`;
            return result;
        }
        
        if (typeof value === 'object') {
            let result = `${indent}<${key}>\n`;
            for (let prop in value) {
                if (value.hasOwnProperty(prop)) {
                    result += convertValue(value[prop], prop, indent + '  ');
                }
            }
            result += `${indent}</${key}>\n`;
            return result;
        }
        
        // Escape special XML characters
        const escaped = String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
        
        return `${indent}<${key}>${escaped}</${key}>\n`;
    }
    
    xml += convertValue(obj, rootName, '');
    return xml;
}