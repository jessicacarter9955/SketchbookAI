// Local browser inference: deliberately no account, API token or provider secret.
// This module runs in a Web Worker; generated conversation text is sent to the
// authenticated TruthLab service for inspection. Model weights come from Hugging Face.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
env.allowLocalModels = false;
let generator = null;
self.onmessage = async ({data}) => {
  try {
    if (data.type === "init") {
      if (!generator) {
        self.postMessage({type:"progress", text:"Downloading Qwen 0.5B quantized model. Initial load can be large."});
        generator=await pipeline("text-generation",
          "onnx-community/Qwen2.5-0.5B-Instruct",
          {device:"webgpu", dtype:"q4",progress_callback:(p)=>{
            if (p.status==="progress") self.postMessage({type:"progress",text:"Qwen download "+Math.round(p.progress||0)+"%"});
          }});
      }
      self.postMessage({type:"ready"});
      return;
    }
    if(data.type==="generate"){
      if(!generator)throw new Error("Qwen model not initialized");
      const prompts=[
        {role:"system",content:data.system},
        {role:"user",content:data.prompt}
      ];
      const out=await generator(prompts,{max_new_tokens:150,do_sample:true,temperature:0.65,top_p:0.9,return_full_text:false});
      let value=out?.[0]?.generated_text;
      if(Array.isArray(value)) value=value.at(-1)?.content||"";
      if(typeof value!=="string"||!value.trim())throw new Error("Qwen returned an empty result");
      self.postMessage({type:"result", id:data.id,text:value.trim().slice(0,4400)});
    }
  }catch(e){self.postMessage({type:"error",id:data.id||null,text:String(e?.message||e)})}
};