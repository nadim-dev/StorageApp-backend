import mongoose from "mongoose";
import { connectDB } from "./mongoose.js";
import { number } from "zod";

await connectDB();

const client=mongoose.connection.getClient();
try{

  const db=mongoose.connection.db;


await db.command({
    collMod:"users",
    validator:{
        
    $jsonSchema: {
       bsonType: 'object',
       required: [
         '_id',
         'name',
         'email',
         'rootDirId'
       ],
       properties: {
         _id: {
           bsonType: 'objectId'
         },
         name: {
           bsonType: 'string'
         },
         email: {
           bsonType: 'string',
           pattern: '^[\\w._%+-]+@[\\w.-]+\\.[A-Za-z]{2,}$'
         },
         password: {
           bsonType: 'string',
           minLength: 3
         },
         rootDirId: {
           bsonType: 'objectId'
         },
         picturePublicId:{
          bsonType:"string",
         },
         pictureVersion:{
          bsonType:"string",
         },
         profilePictureUrl:{
             bsonType:"string",
           },
           maxStorageInBytes:{
            bsonType:"long"
           },
         role:{
           bsonType: "string",
          enum:["Admin","User","Manager","Owner"]
         },
         deleted:{
          bsonType:"bool"
         },
         deletedAt: {
         bsonType:"date"
        },
        deletedBy: {
           bsonType:"string"
        },
        authProvider:{
          bsonType:"string"
        }
       },
       additionalProperties: true
  }
},
 validationAction:"error",
 validationLevel:"strict",
})

await db.command({
  collMod:"recents",
  validator:{
    $jsonSchema:{
      bsonType:"object",
      required:[
        "_id",
        "lastAccessedAt",
        "isDeleted",
        "itemId",
        "userId",
        "itemType"
      ],
      properties:{
          _id:{
            bsonType: 'objectId'
          },
          userId:{
             bsonType: 'objectId'
          },
          itemId:{
              bsonType: 'objectId'
          },
          itemType:{
            bsonType:"string",
            enum:["file","directory"]

          },
          isDeleted:{
            bsonType:"bool"
          },
           lastAccessedAt:{
             bsonType:"date",
           }

      },
       additionalProperties: true
    }
  },
  validationAction:"error",
  validationLevel:"strict",
})


await db.command({
    collMod:"directories",
    validator:{
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'name',
      'userId',
      'parentDirId'
    ],
    properties: {
      _id: {
        bsonType: 'objectId'

      },
      name: {
        bsonType: 'string',
        description:"directory name field should be a string",
      },
      parentDirId: {
        bsonType: [
          'objectId',
          'null'
        ],
       
      },
      userId: {
        bsonType: 'objectId'
      },
      size:{
        bsonType:["number","long","int","double","decimal"]
      },
      starred:{
            bsonType:"bool"
      },
      isDeleted: {
      bsonType:"bool"
      },
      deletedAt:{
         bsonType:["date","null"]
      }
      },
    additionalProperties: true
  }

},
 validationAction:"error",
 validationLevel:"strict",

  })




await  db.command({
    collMod:"files",
    validator:{
        $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'extension',
      'name',
      'userId',
      'parentDirId'
    ],
    properties: {
      _id: {
        bsonType: 'objectId'
      },
      name: {
        bsonType: 'string'
      },
      parentDirId: {
        bsonType: 'objectId'
      },
      extension: {
        bsonType: 'string'
      },
      userId: {
        bsonType: 'objectId'
      },
      size:{
        bsonType:"number"
      },
      starred:{
         bsonType:"bool"
      },
      isDeleted: {
      bsonType:"bool"
      },
      deletedAt:{
         bsonType: ["date", "null"]
      }
    },

    additionalProperties: true
  }
},
 validationAction:"error",
 validationLevel:"strict",
})
}catch(err){
    console.log("error setting up the database",err);
}finally{
    client.close();
}



 
