const express = require('express')
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000
const cors = require('cors')
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion } = require('mongodb');



const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
    'utf-8'
)
const serviceAccount = JSON.parse(decoded)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



// middleware
app.use(
    cors({
        origin: [
            'http://localhost:5173',
            'http://localhost:5174',
            'https://local-chef-bazar.web.app',
        ],
        credentials: true,
        optionSuccessStatus: 200,
    })
)
app.use(express.json())


// jwt middlewares
const verifyJWT = async (req, res, next) => {
    const token = req?.headers?.authorization?.split(' ')[1]
    console.log(token)
    if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.tokenEmail = decoded.email
        console.log(decoded)
        next()
    } catch (err) {
        console.log(err)
        return res.status(401).send({ message: 'Unauthorized Access!', err })
    }
}







// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});





async function run() {
    try {
        
     const db = client.db('MealsDB')
    const MealsCollection = db.collection('meals')


//   save a meals data 
    app.post('/save-meals', async (req, res) => {
      const mealsData = req.body
      console.log(mealsData)
      const result = await MealsCollection.insertOne(mealsData)
      res.send(result)
    })

    // get a meals data
    app.get('/meals',async (req,res)=>{
        const result =await MealsCollection.find().toArray()
        res.send(result)

    })





        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
      
    }
}
run().catch(console.dir);





app.get('/', (req, res) => {
    res.send('Local Chef Bazar runnig')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
