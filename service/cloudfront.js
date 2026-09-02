import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const distributionKey=`https://d1x4vx6q84mqky.cloudfront.net`;
const privateKey=process.env.CLOUDFRONT_PRIVATE_KEY;
const  keyPairId="K2I3KC7U2XPMRJ";

export const createCloudFrontSignedUrl=(key,queryParams={})=>{
  const url=new URL(`${distributionKey}/${key}`);
  Object.entries(queryParams).forEach(([name,value])=>{
    if(value) url.searchParams.set(name,value);
  });

  const signedUrl=getSignedUrl({
    url:url.toString(),
    privateKey,
    keyPairId,
    dateLessThan:new Date(Date.now()+1000 * 60 * 60).toISOString()
  })

  return signedUrl;
}
