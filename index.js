require('dotenv').config();
const dns = require('dns');

const express = require('express');
const cors = require('cors');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}


const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());



const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const firebaseServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
const firebaseServiceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

let serviceAccount;

if (firebaseServiceAccountJson || firebaseServiceAccountBase64) {
  const rawValue = firebaseServiceAccountJson
    ? firebaseServiceAccountJson
    : Buffer.from(firebaseServiceAccountBase64, 'base64').toString('utf8');

  try {
    serviceAccount = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(
      'Failed to parse FIREBASE_SERVICE_ACCOUNT JSON. Ensure it is valid JSON or base64 in FIREBASE_SERVICE_ACCOUNT_BASE64.'
    );
  }
} else if (firebaseServiceAccountPath) {
  const resolvedPath = path.resolve(__dirname, firebaseServiceAccountPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Firebase service account file not found at path: ${resolvedPath}`
    );
  }

  serviceAccount = require(resolvedPath);
} else {
  const candidates = ['./firebase-admin.json', './FIREBASE_SERVICE_ACCOUNT.json'];
  const foundFile = candidates.find((candidate) =>
    fs.existsSync(path.resolve(__dirname, candidate))
  );

  if (!foundFile) {
    throw new Error(
      'Firebase service account JSON not found. Add firebase-admin.json, FIREBASE_SERVICE_ACCOUNT.json, set FIREBASE_SERVICE_ACCOUNT_PATH, or set FIREBASE_SERVICE_ACCOUNT in your environment.'
    );
  }

  serviceAccount = require(path.resolve(__dirname, foundFile));
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});



const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  if (!idToken) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log("decoded info", decoded)
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};



// MongoDB

const uri = process.env.MONGODB_URI;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let userCollections;
let requestCollections;
let notificationCollections; // 👈 globally declare

async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });

    console.log("✅ Connected to MongoDB!");

    // ✅ Database + Collection define

    const database = client.db('DonateBlood');
    userCollections = database.collection('users')
    requestCollections = database.collection('request')
    notificationCollections = database.collection('notifications');

  } catch (error) {
    console.error('❌ MongoDB error:', error.message);
  }
}

connectDB();







// user profile 
app.post('/users', async (req, res) => {
  const userInfo = req.body;
  userInfo.createdAt = new Date();
  userInfo.role = 'donor';
  userInfo.status = 'active';
  const result = await userCollections.insertOne(userInfo);
  res.send(result)

})


app.get('/users', verifyFBToken, async (req, res) => {
  const result = await userCollections.find().toArray()
  res.status(200).send(result)
})

app.get('/users/role/:email', async (req, res) => {
  const email = req.params.email;
  const query = { email: email }
  const result = await userCollections.findOne(query)
  res.send(result)
})

// app.get('/users/:email',async(req,res)=>{
//   const email = req.params.email;
//   const query = {email:email}
//   const result = await userCollections.findOne(query);
//   res.send(result)
// })

app.get('/myRequest', verifyFBToken, async (req, res) => {
  try {
    const email = req.decoded_email;
    const size = Number(req.query.size);
    const page = Number(req.query.page);

    const query = { requesterEmail: email };

    const result = await requestCollections
      .find(query)
      .limit(size)
      .skip(page * size)
      .toArray();

    const totalRequest = await requestCollections.countDocuments(query);

    res.send({ request: result, totalRequest });

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.patch('/update/user/status', async (req, res) => {
  const { email, status } = req.query;
  const query = { email: email };
  const updateStatus = {
    $set: {
      status: status
    }
  }
  const result = await userCollections.updateOne(query, updateStatus);
  res.send(result)
})

//request collection
app.post('/requests', verifyFBToken, async (req, res) => {
  const data = req.body;
  data.createdAt = new Date();
  const result = await requestCollections.insertOne(data)
  res.send(result)

})

app.get('/allRequest', async (req, res) => {
  try {
    const result = await requestCollections.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// view Details 

app.get('/request/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await requestCollections.findOne({
      _id: new ObjectId(id)
    });

    res.send(result);

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// confim 

app.patch('/request/status/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await requestCollections.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          donation_status: 'process'
        }
      }
    );

    res.send(result);

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});



app.get('/notifications/:email', async (req, res) => {
  const email = req.params.email;

  const result = await notificationCollections
    .find({ requesterEmail: email }) // 🔥 filter
    .toArray();

  res.send(result);
});



app.post('/notifications', async (req, res) => {
  const notification = req.body;

  const result = await notificationCollections.insertOne(notification);

  res.send(result);
});


// update part notification hello imran 

app.patch('/request/approve/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // 🔥 1. request status update
    await requestCollections.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          donation_status: 'accepted'
        }
      }
    );

    // 🔥 2. notification status update
    await notificationCollections.updateOne(
      { requestId: id },
      {
        $set: {
          status: 'accepted'
        }
      }
    );

    res.send({ success: true });

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});



// Delete notification 
app.delete('/notifications/:id', async (req, res) => {
  const id = req.params.id;
  const result = await notificationCollections.deleteOne({
    _id: new ObjectId(id)
  });
  res.send(result)
})

// requst collection status change with notification system 
// app.patch('/request/approve/:id', async (req, res) => {
//   try {
//     const id = req.params.id;

//     const result = await requestCollections.updateOne(
//       { _id: new ObjectId(id) },
//       {
//         $set: {
//           donation_status: 'accepted'
//         }
//       }
//     );

//     res.send(result);

//   } catch (error) {
//     res.status(500).send({ error: error.message });
//   }
// });




//Search
app.get('/searchRequest', async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;

    const query = {};

    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const result = await requestCollections.find(query).toArray();

    res.send(result);

  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});







// test route
app.get('/', (req, res) => {
  res.send('🚀 Server is running');
});

// server start
app.listen(port, () => {
  console.log(`🔥 Server running on port ${port}`);
});




//donateBlood
//7pVBCh8cnCuw8GND