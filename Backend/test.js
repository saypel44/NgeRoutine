const axios = require('axios');

axios.post('http://localhost:3000/api/users', {
  name: 'Sonam',
  email: 'sonam@example.com'
})
.then(res => console.log(res.data))
.catch(err => console.log(err.response?.data || err.message));
